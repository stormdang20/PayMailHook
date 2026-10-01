import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import { emailConfigs } from '../core/db/schema';
import { addGmailAccount, connectGmail, syncGmail } from '../core/gmail-oauth';
import { urlPolicy, validateWebhookUrl } from '../core/webhook';
import type { AppEnv } from './app';
import { validate } from './validate';

const pubsubBody = z.object({ message: z.object({ data: z.string() }) });
const notification = z.object({ emailAddress: z.string(), historyId: z.union([z.string(), z.number()]) });

export const gmailRoutes = new Hono<AppEnv>()
  .post(
    '/connect',
    validate(
      'json',
      z.object({
        flow: z.uuid(),
        webhookUrl: z.string().max(2048).nullable().optional(),
        banks: z
          .array(z.enum(['CAKE', 'TIMO']))
          .min(1)
          .transform((values) => [...new Set(values)].sort())
          .optional(),
      }),
    ),
    async (context) => {
      const { deps, user } = context.var;
      if (!deps.gmailPush) return context.json({ error: { code: 'gmail_oauth_not_available' } }, 400);
      const { flow, ...options } = context.req.valid('json');
      const cookieName = `pmh_gmail_${flow}`;
      const accountId = getCookie(context, cookieName);
      if (!accountId) return context.json({ error: { code: 'gmail_connection_expired' } }, 400);
      const reason = options.webhookUrl ? validateWebhookUrl(options.webhookUrl, urlPolicy(deps)) : null;
      if (reason) return context.json({ error: { code: 'invalid_webhook_url', reason } }, 400);
      const result = await addGmailAccount(deps, user.id, accountId, options);
      if (!result) return context.json({ error: { code: 'not_found' } }, 404);
      deleteCookie(context, cookieName, { path: '/api/gmail' });
      return context.json(result);
    },
  )
  // Pub/Sub push subscription endpoint: <app>/api/gmail/pubsub?token=<GOOGLE_PUBSUB_VERIFICATION_TOKEN>.
  // Public; the shared token authenticates Google (inbox-zero does the same).
  .post('/pubsub', validate('json', pubsubBody), async (c) => {
    const { deps } = c.var;
    if (!deps.gmailPush || c.req.query('token') !== deps.gmailPush.verificationToken) {
      return c.json({ error: { code: 'forbidden' } }, 403);
    }
    const data = notification.safeParse(
      JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(c.req.valid('json').message.data))),
    );
    if (!data.success) return c.body(null, 204); // malformed: ack, a retry won't fix it
    const configs = await deps.db
      .select()
      .from(emailConfigs)
      .where(and(eq(emailConfigs.source, 'gmail_oauth'), eq(emailConfigs.gmail, data.data.emailAddress.toLowerCase())));
    // Errors propagate as 5xx so Pub/Sub redelivers; message_id dedupe makes that safe.
    for (const config of configs) await syncGmail(deps, config);
    return c.body(null, 204);
  })
  // Called by the SPA after better-auth's linkSocial returned with the Gmail scope.
  .post('/connect/:id', validate('param', z.object({ id: z.uuid() })), async (c) => {
    const { deps } = c.var;
    if (!deps.gmailPush) return c.json({ error: { code: 'gmail_oauth_not_available' } }, 400);
    const [config] = await deps.db
      .select()
      .from(emailConfigs)
      .where(
        and(
          eq(emailConfigs.id, c.req.valid('param').id),
          eq(emailConfigs.userId, c.var.user.id),
          eq(emailConfigs.source, 'gmail_oauth'),
        ),
      );
    if (!config) return c.json({ error: { code: 'not_found' } }, 404);
    const error = await connectGmail(deps, config);
    return error ? c.json({ error: { code: error } }, 400) : c.json({ ok: true });
  });
