import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import type { Deps } from '../src/core/deps';
import { createTestDb, seedConfig } from './db';
import { makeDeps } from './deps';
import { signUp } from './http';
import { seedTransaction } from './seed';

let db: Database;
let close: () => Promise<void>;
let deps: Deps;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  deps = makeDeps(db).deps;
  app = createApp(() => deps);
});
afterEach(() => close());

/** One JSON-RPC call to /mcp; the streamable HTTP transport may answer as JSON or SSE. */
async function rpc(key: string | null, method: string, params: object = {}) {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(key && { authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  const data = text.startsWith('{') ? text : (text.match(/^data: (.*)$/m)?.[1] ?? 'null');
  return { status: res.status, body: JSON.parse(data) };
}
const toolResult = (body: { result: { content: { text: string }[] } }) => JSON.parse(body.result.content[0].text);

async function ownerWithKey() {
  const { userId } = await signUp(app, db);
  const { key } = await deps.auth.api.createApiKey({ body: { userId, name: 'mcp' } });
  return { userId, key };
}

test('/mcp needs an API key', async () => {
  expect((await rpc(null, 'tools/list')).status).toBe(401);
  expect((await rpc('wrong', 'tools/list')).status).toBe(401);
});

test('lists the two tools and answers payment status for the key owner only', async () => {
  const { userId, key } = await ownerWithKey();
  const mine = await seedConfig(db, { userId, gmail: 'mine@gmail.com' });
  await seedTransaction(db, mine, { orderId: 'A1', amount: 149000 });
  const other = await seedConfig(db, { gmail: 'other@gmail.com' });
  await seedTransaction(db, other, { orderId: 'B2', amount: 5 });

  const tools = (await rpc(key, 'tools/list')).body.result.tools.map((t: { name: string }) => t.name).sort();
  expect(tools).toEqual(['get_payment_status', 'list_transactions']);

  const paid = toolResult(
    (await rpc(key, 'tools/call', { name: 'get_payment_status', arguments: { orderId: 'a1' } })).body,
  );
  expect(paid).toMatchObject({ orderId: 'A1', paid: true, totalAmount: 149000 });
  const exact = toolResult(
    (await rpc(key, 'tools/call', { name: 'get_payment_status', arguments: { orderId: 'A1', amount: 200000 } })).body,
  );
  expect(exact).toMatchObject({ paid: false, totalAmount: 149000 });
  const foreign = toolResult(
    (await rpc(key, 'tools/call', { name: 'get_payment_status', arguments: { orderId: 'B2' } })).body,
  );
  expect(foreign).toMatchObject({ paid: false, totalAmount: 0 });

  const list = toolResult((await rpc(key, 'tools/call', { name: 'list_transactions', arguments: {} })).body);
  expect(list.map((t: { orderId: string }) => t.orderId)).toEqual(['A1']);
});

test('payment status sums only payments in the asked currency', async () => {
  const { userId, key } = await ownerWithKey();
  const config = await seedConfig(db, { userId });
  await seedTransaction(db, config, { orderId: 'C3', amount: 100 });
  await seedTransaction(db, config, { orderId: 'C3', amount: 209, currency: 'USD', bank: 'PAYPAL' });
  const status = async (args: object) =>
    toolResult(
      (await rpc(key, 'tools/call', { name: 'get_payment_status', arguments: { orderId: 'C3', ...args } })).body,
    );
  expect(await status({})).toMatchObject({ paid: true, currency: 'VND', totalAmount: 100 });
  expect(await status({ currency: 'usd', amount: 209 })).toMatchObject({
    paid: true,
    currency: 'USD',
    totalAmount: 209,
  });
  expect(await status({ currency: 'USD', amount: 300 })).toMatchObject({ paid: false, totalAmount: 209 });
  expect(await status({ currency: 'EUR' })).toMatchObject({ paid: false, totalAmount: 0 });
});
