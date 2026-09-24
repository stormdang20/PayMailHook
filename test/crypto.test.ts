import { expect, test } from 'bun:test';
import { decrypt, decryptText, encrypt, encryptText, sha256Hex } from '../src/core/crypto';

const key = crypto.getRandomValues(new Uint8Array(32)).toBase64();

test('sha256Hex matches known vector', async () => {
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

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
