import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth/lib/dkim/sign';
import type { ResolveTxt } from '../src/core/dkim';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Resolver that knows only `test._domainkey.<any domain>`. */
export const testResolver: ResolveTxt = async (name) => {
  if (!name.startsWith('test._domainkey.')) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return [[`v=DKIM1; k=rsa; p=${publicKey.replace(/-----[^-]+-----|\s/g, '')}`]];
};

type EmailOptions = {
  from: string;
  to: string;
  html: string;
  domain: string;
  withDate?: boolean;
  maxBodyLength?: number;
};

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));

function unsignedMessage(o: EmailOptions) {
  const headers = [
    `From: <${o.from}>`,
    `To: ${o.to}`,
    'Subject: test',
    `Message-ID: <${crypto.randomUUID()}@test>`,
    ...(o.withDate === false ? [] : [`Date: ${new Date().toUTCString()}`]),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = `${Buffer.from(o.html).toString('base64').replace(/.{76}/g, '$&\r\n')}\r\n`;
  return { headers, body, message: `${headers.join('\r\n')}\r\n\r\n${body}` };
}

export async function signedEmail(o: EmailOptions) {
  const { message } = unsignedMessage(o);
  const signature = { signingDomain: o.domain, selector: 'test', privateKey, maxBodyLength: o.maxBodyLength };
  // mailauth reads only signatureData at runtime; its .d.ts also demands the top-level fields.
  const { signatures } = await dkimSign(message, { ...signature, signatureData: [signature] });
  return bytes(signatures + message);
}

const relaxedHeader = (line: string) => {
  const i = line.indexOf(':');
  return `${line.slice(0, i).trim().toLowerCase()}:${line
    .slice(i + 1)
    .replace(/\s+/g, ' ')
    .trim()}`;
};

/**
 * Hand-rolled relaxed/relaxed DKIM for an exact h= list, which mailauth's signer can't produce:
 * it only lists headers that exist. Absent names in h= are signed as "no such header" (RFC 6376 §5.4),
 * which is what Timo does with Date. Keep the html short: the body must be a single base64 line.
 */
export function signedEmailWithH(o: EmailOptions, h: string[]) {
  const { headers, body, message } = unsignedMessage(o);
  const byName = new Map(headers.map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l]));
  const bh = createHash('sha256').update(body).digest('base64');
  const dkim = `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=${o.domain}; s=test; h=${h.join(':')}; bh=${bh}; b=`;
  const signed = h.flatMap((name) => (byName.has(name) ? [`${relaxedHeader(byName.get(name) ?? '')}\r\n`] : []));
  const b = createSign('RSA-SHA256')
    .update(signed.join('') + relaxedHeader(dkim))
    .sign(privateKey, 'base64');
  return bytes(`${dkim}${b}\r\n${message}`);
}

/** Prepends a raw header line, e.g. Gmail adding Date or an attacker adding a second To. */
export const prependHeader = (raw: Uint8Array, line: string) =>
  bytes(`${line}\r\n${Buffer.from(raw).toString('latin1')}`);

export const insertDate = (raw: Uint8Array) => prependHeader(raw, 'Date: Wed, 23 Sep 2026 20:42:19 -0700 (PDT)');
