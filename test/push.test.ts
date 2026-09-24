import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { pushSubscriptions } from '../src/core/db/schema';
import { ingestRawEmail } from '../src/core/ingest';
import { contentKeys, encryptPayload, fromB64url, type Vapid, vapidJwt } from '../src/core/push';
import { createTestDb, seedConfig } from './db';
import { makeDeps } from './deps';
import { signedEmail } from './email';
import { call, json, signUp } from './http';

const b64url = (b: Uint8Array) => b.toBase64({ alphabet: 'base64url', omitPadding: true });

async function p256() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { pair, pub, d: d ?? '' };
}

/** What the browser does: decrypt one aes128gcm record with its private key. */
async function browserDecrypt(
  body: Uint8Array,
  receiver: Awaited<ReturnType<typeof p256>>,
  auth: Uint8Array<ArrayBuffer>,
) {
  const salt = body.slice(0, 16);
  const senderPub = body.slice(21, 21 + body[20]);
  const sender = await crypto.subtle.importKey('raw', senderPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, receiver.pair.privateKey, 256),
  );
  const { cek, nonce } = await contentKeys(salt, shared, auth, receiver.pub, senderPub);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + body[20])),
  );
  return new TextDecoder().decode(padded.slice(0, -1));
}

async function makeVapid(): Promise<Vapid & { verifyKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(pub), privateKey: d ?? '', subject: 'https://app.test', verifyKey: pair.publicKey };
}

test('the encrypted payload decrypts in the browser', async () => {
  const receiver = await p256();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload(receiver.pub, auth, new TextEncoder().encode('{"title":"+149.000 đ"}'));
  expect(await browserDecrypt(body, receiver, auth)).toBe('{"title":"+149.000 đ"}');
});

test('the VAPID JWT is an ES256 token the push service can verify', async () => {
  const vapid = await makeVapid();
  const [header, claims, sig] = (await vapidJwt(vapid, 'https://fcm.googleapis.com')).split('.');
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapid.verifyKey,
    fromB64url(sig),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  expect(ok).toBe(true);
  expect(JSON.parse(new TextDecoder().decode(fromB64url(claims)))).toMatchObject({ aud: 'https://fcm.googleapis.com' });
});

let db: Database;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await createTestDb()));
afterEach(() => close());

test('subscribing stores the browser; internal endpoints are refused', async () => {
  const app = createApp(() => makeDeps(db).deps);
  const { cookie } = await signUp(app, db);
  const keys = { p256dh: b64url((await p256()).pub), auth: 'AAAAAAAAAAAAAAAAAAAAAA' };
  const ok = await call(app, cookie, 'POST', '/api/push/subscriptions', {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys,
  });
  expect(ok.status).toBe(201);
  const internal = await call(app, cookie, 'POST', '/api/push/subscriptions', { endpoint: 'https://10.0.0.5/x', keys });
  expect(internal.status).toBe(400);
  expect(await db.$count(pushSubscriptions)).toBe(1);
  expect(
    (
      await call(app, cookie, 'DELETE', '/api/push/subscriptions', {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      })
    ).status,
  ).toBe(204);
  expect(await db.$count(pushSubscriptions)).toBe(0);
});

test('incoming money pushes to every browser of the owner; a gone browser is removed', async () => {
  const config = await seedConfig(db);
  const receiver = await p256();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  for (const endpoint of ['https://push.example.com/alive', 'https://push.example.com/gone']) {
    await db
      .insert(pushSubscriptions)
      .values({ userId: config.userId, endpoint, p256dh: b64url(receiver.pub), auth: b64url(auth) });
  }
  const sent: string[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent.push(await browserDecrypt(new Uint8Array(init.body as Uint8Array), receiver, auth));
    return new Response(null, { status: url.endsWith('/gone') ? 410 : 201 });
  }) as typeof fetch;
  const { deps } = makeDeps(db, { fetch: fakeFetch, vapid: await makeVapid() });
  const html = await Bun.file('test/fixtures/cake/2.html').text();
  const raw = await signedEmail({ from: 'no-reply@cake.vn', to: 'owner@gmail.com', html, domain: 'cake.vn' });
  expect((await ingestRawEmail(deps, config, raw)).status).toBe('stored');
  expect(sent).toHaveLength(2);
  expect(JSON.parse(sent[0])).toMatchObject({ title: '+149.000 đ', url: '/transactions' });
  expect((await db.select().from(pushSubscriptions)).map((s) => s.endpoint)).toEqual([
    'https://push.example.com/alive',
  ]);
});

test('public config exposes the VAPID public key only when push is configured', async () => {
  expect(await json(await createApp(() => makeDeps(db).deps).request('/api/config'))).toMatchObject({
    vapidPublicKey: null,
  });
});
