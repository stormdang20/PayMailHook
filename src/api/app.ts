import { and, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { account, user } from '../core/db/schema';
import type { Deps } from '../core/deps';
import { inboundSignature, receiveForwarded } from '../core/forwarding';
import { isPublicPath, requireUser } from './auth';
import { deliveryRoutes } from './deliveries';
import { emailConfigRoutes } from './email-configs';
import { gmailRoutes } from './gmail';
import { mcpRoutes } from './mcp';
import { pushRoutes } from './push';
import { qrRoutes } from './qr';
import { shareRoutes } from './share';
import { transactionRoutes } from './transactions';
import { validate } from './validate';

type SessionUser = { id: string; role: string | null };
/** Constant-time string comparison for signatures. */
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const hasPassword = async (db: Deps['db'], userId: string) =>
  (await db.$count(account, and(eq(account.userId, userId), eq(account.providerId, 'credential')))) > 0;

export type AppEnv = { Variables: { deps: Deps; user: SessionUser } };

export function createApp(makeDeps: (c: Context) => Deps) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: { code: 'internal' } }, 500);
  });

  app.use('*', async (c, next) => {
    c.set('deps', makeDeps(c));
    await next();
  });

  // Only form-like bodies can be sent cross-site without a CORS preflight; compare with the public host.
  const sameSite = csrf({
    origin: (origin, c) => URL.canParse(origin) && new URL(origin).host === new URL(c.var.deps.appUrl).host,
  });
  app.use('/api/*', (c, next) => (isPublicPath(c.req.path) ? next() : sameSite(c, next)));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => c.var.deps.auth.handler(c.req.raw));
  app.use('/api/*', requireUser);

  // Chained so AppType carries every route for the typed `hc<AppType>` client in web/.
  return (
    app
      // Public: lets the SPA show only sign-in buttons that can work (like react-starter-kit).
      .get('/api/config', (c) =>
        c.json({
          socialProviders: Object.keys(c.var.deps.auth.options.socialProviders ?? {}),
          imap: c.var.deps.imapEnabled,
          vapidPublicKey: c.var.deps.vapid?.publicKey ?? null,
          gmailOAuth: Boolean(c.var.deps.gmailPush),
          forwarding: Boolean(c.var.deps.inbound),
        }),
      )
      .get('/api/me', async (c) => {
        const { db } = c.var.deps;
        const [me] = await db
          .select({ id: user.id, email: user.email, name: user.name, role: user.role })
          .from(user)
          .where(eq(user.id, c.var.user.id));
        return c.json({ ...me, hasPassword: await hasPassword(db, c.var.user.id) });
      })
      // Accounts that only sign in with Google can add a password (better-auth's setPassword is server-only).
      .post('/api/me/password', validate('json', z.object({ newPassword: z.string().min(8).max(128) })), async (c) => {
        const { deps } = c.var;
        if (await hasPassword(deps.db, c.var.user.id)) return c.json({ error: { code: 'password_exists' } }, 400);
        await deps.auth.api.setPassword({ body: c.req.valid('json'), headers: c.req.raw.headers });
        return c.json({ ok: true });
      })
      .route('/api/email-configs', emailConfigRoutes)
      .route('/api/transactions', transactionRoutes)
      .route('/api/webhook-deliveries', deliveryRoutes)
      .route('/api/qr', qrRoutes)
      .route('/api/share', shareRoutes)
      .route('/api/push', pushRoutes)
      .route('/api/gmail', gmailRoutes)
      .route('/mcp', mcpRoutes)
      // Self-host forwarding: the relay Worker (deploy/email-relay) posts each message here, HMAC-signed.
      .post('/api/inbound', async (c) => {
        const { deps } = c.var;
        const secret = deps.inbound?.secret;
        if (!secret) return c.json({ error: { code: 'not_found' } }, 404);
        const to = c.req.header('x-inbound-to') ?? '';
        const raw = new Uint8Array(await c.req.arrayBuffer());
        const signature = c.req.header('x-inbound-signature') ?? '';
        if (!timingSafeEqual(signature, await inboundSignature(secret, to, raw))) {
          return c.json({ error: { code: 'unauthorized' } }, 401);
        }
        const result = await receiveForwarded(deps, to, raw);
        return result.status === 'unknown_recipient'
          ? c.json({ error: { code: 'unknown_recipient' } }, 404)
          : c.json({ ok: true, ...result });
      })
  );
}

export type AppType = ReturnType<typeof createApp>;
