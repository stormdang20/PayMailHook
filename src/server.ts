import { inArray } from 'drizzle-orm';
import { serveStatic } from 'hono/bun';
import { createApp } from './api/app';
import { createAuth } from './core/auth';
import { createDb } from './core/db/client';
import { migrateDb } from './core/db/migrate';
import { webhookDeliveries } from './core/db/schema';
import type { Deps } from './core/deps';
import { dohResolveTxt } from './core/dkim';
import { gmailPushFrom, parseEnv, vapidFrom } from './core/env';
import { runMaintenance } from './core/maintenance';
import { deliver } from './core/webhook';
import { superviseImap } from './imap';

const CLIENT_IP_HEADER = 'x-client-ip';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
// Self-host default: webhooks usually point at an app on the LAN (design §3.4).
const env = parseEnv({ ALLOW_PRIVATE_WEBHOOKS: 'true', ...process.env });

await migrateDb(databaseUrl); // self-host: `docker compose up` needs no separate migrate step
const { db } = createDb(databaseUrl);
const deps: Deps = {
  db,
  auth: createAuth(db, env, undefined, CLIENT_IP_HEADER),
  resolveTxt: dohResolveTxt,
  encryptionKey: env.ENCRYPTION_KEY,
  fetch,
  allowPrivateWebhooks: env.ALLOW_PRIVATE_WEBHOOKS,
  imapEnabled: true,
  vapid: vapidFrom(env),
  gmailPush: gmailPushFrom(env),
  appUrl: env.BETTER_AUTH_URL,
  // ponytail: in-process timers; state lives in the DB and the startup scan below re-arms them.
  scheduleDelivery: async (id, delaySeconds, trigger) => {
    setTimeout(() => deliver(deps, id, trigger).catch(console.error), delaySeconds * 1000);
  },
};

// Self-host startup: re-arm timers for every open delivery.
const open = await db
  .select({ id: webhookDeliveries.id, at: webhookDeliveries.nextAttemptAt })
  .from(webhookDeliveries)
  .where(inArray(webhookDeliveries.status, ['pending', 'retrying']));
for (const d of open) await deps.scheduleDelivery(d.id, Math.max(0, ((d.at?.getTime() ?? 0) - Date.now()) / 1000));
setInterval(() => runMaintenance(deps).catch(console.error), 60 * 60 * 1000);
superviseImap(deps);

// Self-host serves the SPA too (dist/client from `bun run build`); unknown /api paths stay 404.
const app = createApp(() => deps);
const spa = serveStatic({ path: './dist/client/index.html' });
app.use('*', serveStatic({ root: './dist/client' }));
app.use('*', (c, next) => (c.req.path.startsWith('/api/') || c.req.path === '/mcp' ? next() : spa(c, next)));

export default {
  port: Number(process.env.PORT ?? 3000),
  // The socket address, overwriting any client-sent value, is what better-auth rate-limits by.
  // ponytail: behind a reverse proxy this is the proxy's IP (one shared bucket); add trusted-proxy support if needed.
  fetch(req: Request, server: Bun.Server<undefined>) {
    const headers = new Headers(req.headers);
    headers.set(CLIENT_IP_HEADER, server.requestIP(req)?.address ?? 'unknown');
    return app.fetch(new Request(req, { headers }));
  },
};
