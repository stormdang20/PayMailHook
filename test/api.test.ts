import { expect, test } from 'bun:test';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { inboundSignature } from '../src/core/forwarding';
import { makeDeps } from './deps';

const INBOUND = { domain: 'in.test', secret: 'relay-secret' };
const TO = 'pmh-0123456789abcdef@in.test';

test('database failure is a 500 without details, so the sender retries', async () => {
  const brokenDb = new Proxy({} as Database, {
    get: () => () => {
      throw new Error('connection refused');
    },
  });
  const app = createApp(() => makeDeps(brokenDb, { inbound: INBOUND }).deps);
  const raw = new TextEncoder().encode('Subject: x\r\n\r\nx');
  const errorLog = console.error;
  console.error = () => {};
  const res = await app.request('/api/inbound', {
    method: 'POST',
    headers: { 'x-inbound-to': TO, 'x-inbound-signature': await inboundSignature(INBOUND.secret, TO, raw) },
    body: raw,
  });
  console.error = errorLog;
  expect(res.status).toBe(500);
  const body: unknown = await res.json();
  expect(body).toEqual({ error: { code: 'internal' } });
});
