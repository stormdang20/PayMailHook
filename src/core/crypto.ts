const utf8 = new TextEncoder();

export const randomToken = (bytes = 24) =>
  crypto.getRandomValues(new Uint8Array(bytes)).toBase64({ alphabet: 'base64url', omitPadding: true });

const aesKey = (keyB64: string) =>
  crypto.subtle.importKey('raw', Uint8Array.fromBase64(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);

/** Output layout: 12-byte IV || ciphertext+tag. */
export async function encrypt(keyB64: string, data: Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export async function decrypt(keyB64: string, blob: Uint8Array) {
  const params = { name: 'AES-GCM', iv: blob.slice(0, 12) };
  return new Uint8Array(await crypto.subtle.decrypt(params, await aesKey(keyB64), blob.slice(12)));
}

export const encryptText = async (keyB64: string, s: string) => (await encrypt(keyB64, utf8.encode(s))).toBase64();
export const decryptText = async (keyB64: string, s: string) =>
  new TextDecoder().decode(await decrypt(keyB64, Uint8Array.fromBase64(s)));
