import { expect, test } from 'bun:test';
import { decrypt, decryptText, encrypt, encryptText } from '../src/core/crypto';

const key = crypto.getRandomValues(new Uint8Array(32)).toBase64();

test('AES-GCM round-trips bytes and text, with a fresh IV each time', async () => {
  const data = new TextEncoder().encode('raw mime');
  expect(await decrypt(key, await encrypt(key, data))).toEqual(data);
  expect(await decryptText(key, await encryptText(key, 'whsec_x'))).toBe('whsec_x');
  expect(await encryptText(key, 'same')).not.toBe(await encryptText(key, 'same'));
});

test('AES-GCM rejects a tampered ciphertext', async () => {
  const blob = await encrypt(key, new TextEncoder().encode('raw mime'));
  blob[blob.length - 1] ^= 1;
  await expect(decrypt(key, blob)).rejects.toThrow();
});
