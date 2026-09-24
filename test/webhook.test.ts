import { expect, test } from 'bun:test';
import { Webhook } from 'standardwebhooks';
import { newWebhookSecret, signWebhook, validateWebhookUrl } from '../src/core/webhook';

test('signature verifies with the standardwebhooks library', async () => {
  const secret = newWebhookSecret();
  const ts = Math.floor(Date.now() / 1000);
  const body = '{"type":"payment.received"}';
  const headers = {
    'webhook-id': 'd1',
    'webhook-timestamp': String(ts),
    'webhook-signature': await signWebhook(secret, 'd1', ts, body),
  };
  expect(() => new Webhook(secret).verify(body, headers)).not.toThrow();
});

const strict = { allowPrivate: false, appHost: 'paymailhook.example.workers.dev' };
test.each([
  ['https://shop.example.com/hook', null],
  ['https://shop.example.com:443/hook', null],
  ['http://shop.example.com/hook', 'https_required'],
  ['https://user:pw@shop.example.com', 'credentials_not_allowed'],
  ['https://shop.example.com:8443', 'port_not_allowed'],
  ['https://127.0.0.1/x', 'ip_not_allowed'],
  ['https://127.0.0.1./x', 'ip_not_allowed'],
  ['https://0x7f000001/x', 'ip_not_allowed'],
  ['https://[::1]/x', 'ip_not_allowed'],
  ['https://localhost/x', 'host_not_allowed'],
  ['https://localhost./x', 'host_not_allowed'],
  ['https://printer.local/x', 'host_not_allowed'],
  ['https://printer.local./x', 'host_not_allowed'],
  ['https://intranet/x', 'host_not_allowed'],
  ['https://paymailhook.example.workers.dev/x', 'host_not_allowed'],
  ['not a url', 'invalid_url'],
])('validateWebhookUrl(%s) → %s', (url, expected) => {
  expect(validateWebhookUrl(url, strict)).toBe(expected);
});

test('self-host mode allows LAN http but not other schemes', () => {
  expect(validateWebhookUrl('http://192.168.1.10:8080/hook', { ...strict, allowPrivate: true })).toBeNull();
  expect(validateWebhookUrl('ftp://192.168.1.10/hook', { ...strict, allowPrivate: true })).toBe('invalid_protocol');
});
