// Usage: bun scripts/generate-vapid.ts — prints a Web Push (VAPID) key pair for .env / wrangler secrets.
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${publicKey.toBase64({ alphabet: 'base64url', omitPadding: true })}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);

export {}; // top-level await needs a module
