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
      description: 'Latest bank transactions (VND) read from the notification emails, newest first.',
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
        'Whether an order has been paid: sums incoming transfers carrying the order code. With `amount`, paid means the sum covers it.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        orderId: z.string().max(64).describe('Order code without the prefix, e.g. 123456 for "PMH123456"'),
        amount: z.number().int().positive().optional().describe('Expected amount in VND'),
      },
    },
    async ({ orderId, amount }) => {
      const code = orderId.toUpperCase();
      const payments = await db
        .select(columns)
        .from(transactions)
        .where(and(mine, eq(transactions.orderId, code), eq(transactions.direction, 'in')))
        .orderBy(desc(transactions.occurredAt));
      const totalAmount = payments.reduce((sum, t) => sum + t.amount, 0);
      const paid = payments.length > 0 && (amount === undefined || totalAmount >= amount);
      return text({ orderId: code, paid, totalAmount, payments });
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
