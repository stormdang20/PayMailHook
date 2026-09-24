import { expect, test } from 'bun:test';
import { buildPayload } from '../src/core/webhook';
import { SAMPLE_PAYLOAD } from '../web/lib/webhook-sample';

test('the guide page shows the payload shape the server really sends', () => {
  const { transaction: t } = SAMPLE_PAYLOAD.data;
  const built = buildPayload({
    ...t,
    direction: 'in',
    occurredAt: new Date(t.occurredAt),
    balanceAfter: undefined,
    orderId: SAMPLE_PAYLOAD.data.orderId,
  });
  expect(JSON.parse(JSON.stringify(built))).toEqual(SAMPLE_PAYLOAD);
});
