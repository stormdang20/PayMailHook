import { inArray } from 'drizzle-orm';
import { createApp } from './api/app';
import { createAuth } from './core/auth';
import { createDb } from './core/db/client';
import { webhookDeliveries } from './core/db/schema';
import type { Deps } from './core/deps';
import { dohResolveTxt } from './core/dkim';
import { appHost, parseEnv } from './core/env';
import { runMaintenance } from './core/maintenance';
import { deliver } from './core/webhook';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
// Self-host default: webhooks usually point at an app on the LAN (design §3.4).
const env = parseEnv({ ALLOW_PRIVATE_WEBHOOKS: 'true', ...process.env });

const { db } = createDb(databaseUrl);
const deps: Deps = {
  db,
  auth: createAuth(db, env),
  resolveTxt: dohResolveTxt,
  encryptionKey: env.ENCRYPTION_KEY,
  fetch,
  allowPrivateWebhooks: env.ALLOW_PRIVATE_WEBHOOKS,
  appHost: appHost(env),
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

export default { port: Number(process.env.PORT ?? 3000), fetch: createApp(() => deps).fetch };
