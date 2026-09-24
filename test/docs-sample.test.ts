import { expect, test } from 'bun:test';
import { buildPayload } from '../src/core/webhook';

test('docs/api.md shows the webhook payload the server really sends', async () => {
  const md = await Bun.file('docs/api.md').text();
  const block = md.split('<!-- sample-payload')[1]?.match(/```json\n([\s\S]*?)\n```/)?.[1];
  const sample = JSON.parse(block ?? 'null');
  const t = sample.data.transaction;
  const built = buildPayload({
    ...t,
    occurredAt: new Date(t.occurredAt),
    balanceAfter: undefined,
    orderId: sample.data.orderId,
  });
  expect(JSON.parse(JSON.stringify(built))).toEqual(sample);
});
