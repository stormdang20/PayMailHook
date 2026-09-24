// Web Push: RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID), WebCrypto only so it runs on
// Workers and Bun. Ported from saasmail's worker/src/lib/web-push.ts.
import { eq } from 'drizzle-orm';
import type { ParsedTxn } from './banks';
import { pushSubscriptions } from './db/schema';
import type { Deps } from './deps';
import { validateWebhookUrl } from './webhook';

export type Vapid = { publicKey: string; privateKey: string; subject: string }; // base64url raw P-256 keys
type Bytes = Uint8Array<ArrayBuffer>;

const b64url = (bytes: Uint8Array) => bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
export const fromB64url = (s: string): Bytes => Uint8Array.fromBase64(s, { alphabet: 'base64url' });
const utf8 = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** HKDF with output ≤ 32 bytes: one HMAC block (info || 0x01). */
const hkdf = async (salt: Bytes, ikm: Bytes, info: Bytes, length: number) =>
  (await hmac(await hmac(salt, ikm), concat(info, new Uint8Array([1])))).slice(0, length);

/** Content keys shared by sender and browser (RFC 8291 §3.3–3.4). */
export async function contentKeys(salt: Bytes, shared: Bytes, auth: Bytes, receiverPub: Bytes, senderPub: Bytes) {
  const ikm = await hkdf(auth, shared, concat(utf8('WebPush: info\0'), receiverPub, senderPub), 32);
  return {
    cek: await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16),
    nonce: await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12),
  };
}

/** One aes128gcm record: salt(16) | rs(4) | idlen(1) | sender public key(65) | ciphertext. */
export async function encryptPayload(receiverPub: Bytes, auth: Bytes, plaintext: Bytes) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const sender = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const senderPub = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const receiver = await crypto.subtle.importKey('raw', receiverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiver }, sender.privateKey, 256),
  );
  const { cek, nonce } = await contentKeys(salt, shared, auth, receiverPub, senderPub);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02: last record (RFC 8188)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, padded));
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([senderPub.length]), senderPub, ciphertext);
}

/** ES256 JWT for the push service's origin (RFC 8292). */
export async function vapidJwt(vapid: Vapid, audience: string) {
  const pub = fromB64url(vapid.publicKey); // 0x04 | X | Y
  const jwk = { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), d: vapid.privateKey };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o: object) => b64url(utf8(JSON.stringify(o)));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const input = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: audience, exp, sub: vapid.subject })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(input)));
  return `${input}.${b64url(sig)}`;
}

/** Push endpoints come from the browser, so they get the same SSRF rules as a public webhook URL. */
export const pushEndpointError = (endpoint: string, appHost: string) =>
  validateWebhookUrl(endpoint, { allowPrivate: false, appHost });

/** Notifies every browser of the user about incoming money; never throws, drops expired subscriptions. */
export async function notifyIncoming(deps: Deps, userId: string, txn: ParsedTxn, orderId: string | null) {
  const { vapid } = deps;
  if (!vapid || txn.direction !== 'in') return;
  const subs = await deps.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  const vnd = new Intl.NumberFormat('vi-VN').format(txn.amount);
  const payload = utf8(
    JSON.stringify({
      title: `+${vnd} đ`,
      body: orderId ? `Đơn ${orderId}: ${txn.description}` : txn.description,
      url: '/transactions',
    }),
  );
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const endpoint = new URL(sub.endpoint);
        const res = await deps.fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            TTL: '3600',
            urgency: 'high',
            'content-encoding': 'aes128gcm',
            'content-type': 'application/octet-stream',
            authorization: `vapid t=${await vapidJwt(vapid, endpoint.origin)}, k=${vapid.publicKey}`,
          },
          body: await encryptPayload(fromB64url(sub.p256dh), fromB64url(sub.auth), payload),
        });
        if (res.status === 404 || res.status === 410) {
          await deps.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)); // browser unsubscribed
        }
      } catch (e) {
        console.error('push failed:', e); // a notification must never break ingest
      }
    }),
  );
}
