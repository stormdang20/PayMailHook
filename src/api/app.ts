import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { sha256Hex } from '../core/crypto';
import { emailConfigs, user } from '../core/db/schema';
import type { Deps } from '../core/deps';
import { ingestRawEmail } from '../core/ingest';
import { isPublicPath, requireUser } from './auth';
import { deliveryRoutes } from './deliveries';
import { emailConfigRoutes } from './email-configs';
import { qrRoutes } from './qr';
import { transactionRoutes } from './transactions';

export type SessionUser = { id: string; role: string | null };
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
        }),
      )
      .get('/api/me', async (c) => {
        const [me] = await c.var.deps.db
          .select({ id: user.id, email: user.email, name: user.name, role: user.role })
          .from(user)
          .where(eq(user.id, c.var.user.id));
        return c.json(me);
      })
      .route('/api/email-configs', emailConfigRoutes)
      .route('/api/transactions', transactionRoutes)
      .route('/api/webhook-deliveries', deliveryRoutes)
      .route('/api/qr', qrRoutes)
      .post('/api/ingest', async (c) => {
        const { deps } = c.var;
        const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
        const [config] = token
          ? await deps.db
              .select()
              .from(emailConfigs)
              .where(eq(emailConfigs.ingestTokenHash, await sha256Hex(token)))
          : [];
        if (!config) return c.json({ error: { code: 'unauthorized' } }, 401);
        const result = await ingestRawEmail(deps, config, new Uint8Array(await c.req.arrayBuffer()));
        return c.json({ ok: true, ...result });
      })
  );
}

export type AppType = ReturnType<typeof createApp>;
