// MCP server (P4, e.g. for Xiaozhi AI): read-only tools over the key owner's transactions.
// Stateless like saasmail's: one McpServer + transport per request. Auth: API key only.
import { StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { transactions } from '../core/db/schema';
import type { Deps } from '../core/deps';
import type { AppEnv } from './app';
import { keyRejection, userFromApiKey } from './auth';

const columns = {
  bank: transactions.bank,
  direction: transactions.direction,
  amount: transactions.amount,
  currency: transactions.currency,
  description: transactions.description,
  orderId: transactions.orderId,
  counterpartyName: transactions.counterpartyName,
  occurredAt: transactions.occurredAt,
};
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

function buildServer({ db }: Deps, userId: string) {
  const server = new McpServer({ name: 'PayMailHook', version: '1.0.0' });
  const mine = eq(transactions.userId, userId);

  server.registerTool(
    'list_transactions',
    {
      description:
        'Latest transactions read from the bank and PayPal notification emails, newest first. `amount` is in minor units of `currency` (VND: đồng, USD: cents).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        direction: z.enum(['in', 'out']).optional().describe('"in" for money received, "out" for money sent'),
        orderId: z.string().max(64).optional().describe('Only transactions with this order code'),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ direction, orderId, limit }) =>
      text(
        await db
          .select(columns)
          .from(transactions)
          .where(
            and(
              mine,
              direction ? eq(transactions.direction, direction) : undefined,
              orderId ? eq(transactions.orderId, orderId.toUpperCase()) : undefined,
            ),
          )
          .orderBy(desc(transactions.occurredAt))
          .limit(limit),
      ),
  );

  server.registerTool(
    'get_payment_status',
    {
      description:
        'Whether an order has been paid: sums incoming payments in `currency` carrying the order code. With `amount`, paid means the sum covers it.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        orderId: z.string().max(64).describe('Order code without the prefix, e.g. 123456 for "PMH123456"'),
        amount: z.number().int().positive().optional().describe('Expected amount in minor units of `currency`'),
        currency: z
          .string()
          .regex(/^[a-z]{3}$/i)
          .default('VND')
          .describe('ISO 4217 code, e.g. VND or USD'),
      },
    },
    async ({ orderId, amount, currency: asked }) => {
      const code = orderId.toUpperCase();
      const currency = asked.toUpperCase();
      const payments = await db
        .select(columns)
        .from(transactions)
        .where(
          and(
            mine,
            eq(transactions.orderId, code),
            eq(transactions.direction, 'in'),
            eq(transactions.currency, currency),
          ),
        )
        .orderBy(desc(transactions.occurredAt));
      const totalAmount = payments.reduce((sum, t) => sum + t.amount, 0);
      const paid = payments.length > 0 && (amount === undefined || totalAmount >= amount);
      return text({ orderId: code, paid, currency, totalAmount, payments });
    },
  );
  return server;
}

export const mcpRoutes = new Hono<AppEnv>().all('/', async (c) => {
  const { deps } = c.var;
  // MCP clients send `Authorization: Bearer <key>`; `x-api-key` works too, like the REST API.
  const key = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? c.req.header('x-api-key');
  const check = await userFromApiKey(deps, key);
  if (!check || !('userId' in check)) return keyRejection(check);
  const transport = new StreamableHTTPTransport();
  await buildServer(deps, check.userId).connect(transport);
  return transport.handleRequest(c);
});
