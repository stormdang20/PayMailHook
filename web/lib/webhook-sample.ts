/** Example body for the guide page; test/guide-sample.test.ts keeps it identical to buildPayload(). */
export const SAMPLE_PAYLOAD = {
  type: 'payment.received',
  timestamp: '2026-09-20T11:28:07.000Z',
  data: {
    orderId: '123456',
    transaction: {
      id: '9b2f6c1e-0000-4000-8000-000000000001',
      bank: 'CAKE',
      direction: 'in',
      amount: 149000,
      currency: 'VND',
      description: 'PMH123456',
      bankTxnId: '500000001',
      balanceAfter: null,
      counterparty: { name: 'NGUYEN VAN A', account: '123456***7890', bank: 'TIMO' },
      occurredAt: '2026-09-20T11:28:07.000Z',
    },
  },
};
