import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { encryptText } from '../core/crypto';
import { bank, emailConfigs } from '../core/db/schema';
import type { Deps } from '../core/deps';
import { newForwardingAddress } from '../core/forwarding';
import { buildPayload, newWebhookSecret, postWebhook, urlPolicy, validateWebhookUrl } from '../core/webhook';
import type { AppEnv } from './app';
import { share, unshare } from './share';
import { validate } from './validate';

/** Never select encrypted secrets into a response. */
const publicColumns = {
  id: emailConfigs.id,
  gmail: emailConfigs.gmail,
  source: emailConfigs.source,
  orderPrefix: emailConfigs.orderPrefix,
  banks: emailConfigs.banks,
  webhookUrl: emailConfigs.webhookUrl,
  lastIngestAt: emailConfigs.lastIngestAt,
  ingestError: emailConfigs.ingestError,
  hasImapPassword: sql<boolean>`${emailConfigs.imapPasswordEnc} is not null`,
  shareToken: emailConfigs.shareToken,
  forwardingAddress: emailConfigs.forwardingAddress,
  forwardingConfirmation: emailConfigs.forwardingConfirmation,
  gmailConnected: sql<boolean>`${emailConfigs.googleAccountId} is not null`,
  createdAt: emailConfigs.createdAt,
};

// Letters and digits only: extractOrderId would otherwise match any code (see deviation 1.4-d).
const orderPrefix = z
  .string()
  .regex(/^[A-Za-z0-9]{1,16}$/)
  .transform((s) => s.toUpperCase());
const webhookUrl = z.string().max(2048).nullable();
// Google shows App Passwords as "abcd efgh ijkl mnop"; accept it pasted with or without spaces.
const imapPassword = z
  .string()
  .transform((s) => s.replace(/\s/g, ''))
  .pipe(z.string().regex(/^[A-Za-z]{16}$/, 'App Password is 16 letters'));
// Which banks' notifications this Gmail receives; a set of the banks PayMailHook reads.
const banks = z
  .array(z.enum(bank.enumValues))
  .min(1)
  .transform((list) => [...new Set(list)].sort());
const idParam = validate('param', z.object({ id: z.uuid() }));

const owned = (userId: string, id: string) => and(eq(emailConfigs.id, id), eq(emailConfigs.userId, userId));
const urlError = (deps: Deps, url: string | null | undefined) =>
  url ? validateWebhookUrl(url, urlPolicy(deps)) : null;
const badUrl = (reason: string) => ({ error: { code: 'invalid_webhook_url', reason } });
const notFound = { error: { code: 'not_found' } };

const SAMPLE_TXN = {
  direction: 'in' as const,
  amount: 10000,
  description: 'PMHTEST chuyen tien',
  occurredAt: new Date('2026-01-01T03:00:00Z'),
  bankTxnId: '000000000',
  counterparty: { name: 'NGUYEN VAN A', account: '0123456789', bank: 'TIMO' },
};

export const emailConfigRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { db } = c.var.deps;
    const rows = await db
      .select(publicColumns)
      .from(emailConfigs)
      .where(eq(emailConfigs.userId, c.var.user.id))
      .orderBy(desc(emailConfigs.createdAt));
    return c.json(rows);
  })
  .post(
    '/',
    validate(
      'json',
      z
        .object({
          gmail: z.email().transform((s) => s.trim().toLowerCase()),
          webhookUrl: webhookUrl.optional(),
          orderPrefix: orderPrefix.optional(),
          banks: banks.optional(),
          source: z.enum(['imap', 'gmail_oauth', 'forwarding']),
          imapPassword: imapPassword.optional(),
        })
        .refine((b) => b.source !== 'imap' || b.imapPassword, { path: ['imapPassword'], message: 'required for imap' }),
    ),
    async (c) => {
      const { deps } = c.var;
      const { imapPassword, ...body } = c.req.valid('json');
      if (body.source === 'imap' && !deps.imapEnabled) return c.json({ error: { code: 'imap_not_available' } }, 400);
      if (body.source === 'forwarding' && !deps.inbound)
        return c.json({ error: { code: 'forwarding_not_available' } }, 400);
      if (body.source === 'gmail_oauth' && !deps.gmailPush) {
        return c.json({ error: { code: 'gmail_oauth_not_available' } }, 400);
      }
      const reason = urlError(deps, body.webhookUrl);
      if (reason) return c.json(badUrl(reason), 400);
      const webhookSecret = newWebhookSecret();
      const [config] = await deps.db
        .insert(emailConfigs)
        .values({
          ...body,
          userId: c.var.user.id,
          webhookSecretEnc: await encryptText(deps.encryptionKey, webhookSecret),
          imapPasswordEnc: imapPassword ? await encryptText(deps.encryptionKey, imapPassword) : null,
          forwardingAddress:
            body.source === 'forwarding' && deps.inbound ? newForwardingAddress(deps.inbound.domain) : null,
        })
        .returning(publicColumns);
      // Shown once: only the encrypted secret is stored.
      return c.json({ config, webhookSecret }, 201);
    },
  )
  .get('/:id', idParam, async (c) => {
    const [config] = await c.var.deps.db
      .select(publicColumns)
      .from(emailConfigs)
      .where(owned(c.var.user.id, c.req.valid('param').id));
    return config ? c.json(config) : c.json(notFound, 404);
  })
  .patch(
    '/:id',
    idParam,
    validate(
      'json',
      z.object({
        webhookUrl: webhookUrl.optional(),
        orderPrefix: orderPrefix.optional(),
        banks: banks.optional(),
        imapPassword: imapPassword.optional(),
      }),
    ),
    async (c) => {
      const { deps } = c.var;
      const { imapPassword, ...body } = c.req.valid('json');
      const reason = urlError(deps, body.webhookUrl);
      if (reason) return c.json(badUrl(reason), 400);
      // A new App Password clears imap_auth_failed, which lets superviseImap start the listener again.
      const password = imapPassword
        ? { imapPasswordEnc: await encryptText(deps.encryptionKey, imapPassword), ingestError: null }
        : {};
      const [config] = await deps.db
        .update(emailConfigs)
        .set({ ...body, ...password })
        .where(owned(c.var.user.id, c.req.valid('param').id))
        .returning(publicColumns);
      return config ? c.json(config) : c.json(notFound, 404);
    },
  )
  .delete('/:id', idParam, async (c) => {
    const deleted = await c.var.deps.db
      .delete(emailConfigs)
      .where(owned(c.var.user.id, c.req.valid('param').id))
      .returning({ id: emailConfigs.id });
    return deleted.length ? c.body(null, 204) : c.json(notFound, 404);
  })
  .post('/:id/rotate-secret', idParam, async (c) => {
    const { deps } = c.var;
    const webhookSecret = newWebhookSecret(); // replaces the old secret immediately (design §3.1)
    const updated = await deps.db
      .update(emailConfigs)
      .set({ webhookSecretEnc: await encryptText(deps.encryptionKey, webhookSecret) })
      .where(owned(c.var.user.id, c.req.valid('param').id))
      .returning({ id: emailConfigs.id });
    return updated.length ? c.json({ webhookSecret }) : c.json(notFound, 404);
  })
  .post('/:id/test-webhook', idParam, async (c) => {
    const { deps } = c.var;
    const [config] = await deps.db
      .select({
        url: emailConfigs.webhookUrl,
        secretEnc: emailConfigs.webhookSecretEnc,
        prefix: emailConfigs.orderPrefix,
      })
      .from(emailConfigs)
      .where(owned(c.var.user.id, c.req.valid('param').id));
    if (!config) return c.json(notFound, 404);
    if (!config.url || !config.secretEnc) return c.json({ error: { code: 'webhook_not_configured' } }, 400);
    const reason = urlError(deps, config.url);
    if (reason) return c.json(badUrl(reason), 400);
    // Synchronous, stored nowhere, never retried (design §3.5).
    const id = crypto.randomUUID();
    const payload = { ...buildPayload({ ...SAMPLE_TXN, id, bank: 'CAKE', orderId: 'TEST' }), type: 'payment.test' };
    const started = Date.now();
    const outcome = await postWebhook(deps, id, payload, config.url, config.secretEnc);
    return c.json({ ...outcome, durationMs: Date.now() - started });
  })
  .post('/:id/share', idParam, async (c) => {
    const token = await share(c.var.deps.db, emailConfigs, c.var.user.id, c.req.valid('param').id);
    return token ? c.json({ token }) : c.json(notFound, 404);
  })
  .delete('/:id/share', idParam, async (c) => {
    const done = await unshare(c.var.deps.db, emailConfigs, c.var.user.id, c.req.valid('param').id);
    return done ? c.body(null, 204) : c.json(notFound, 404);
  });
