import { inArray } from 'drizzle-orm';
import { createApp } from './api/app';
import { createDb } from './core/db/client';
import { webhookDeliveries } from './core/db/schema';
import type { Deps } from './core/deps';
import { dohResolveTxt } from './core/dkim';
import { runMaintenance } from './core/maintenance';
import { deliver } from './core/webhook';

const env = process.env;
const required = (name: string) => {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const { db } = createDb(required('DATABASE_URL'));
const deps: Deps = {
  db,
  resolveTxt: dohResolveTxt,
  encryptionKey: required('ENCRYPTION_KEY'),
  fetch,
  allowPrivateWebhooks: env.ALLOW_PRIVATE_WEBHOOKS !== 'false',
  appHost: env.APP_HOST ?? 'localhost',
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

export default { port: Number(env.PORT ?? 3000), fetch: createApp(() => deps).fetch };
