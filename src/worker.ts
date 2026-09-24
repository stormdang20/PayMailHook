import { createApp } from './api/app';
import { createDb } from './core/db/client';
import type { Deps, Trigger } from './core/deps';
import { dohResolveTxt } from './core/dkim';
import { runMaintenance } from './core/maintenance';
import { deliver } from './core/webhook';

type QueueMessage = { id: string; trigger: Trigger };
type Env = {
  HYPERDRIVE: Hyperdrive;
  QUEUE: Queue<QueueMessage>;
  ENCRYPTION_KEY: string;
  APP_HOST: string;
  ALLOW_PRIVATE_WEBHOOKS?: string;
};

// A new postgres.js client per invocation is what Hyperdrive recommends; it cleans the
// connection up when the invocation ends, so there is nothing to close.
function makeDeps(env: Env): Deps {
  return {
    db: createDb(env.HYPERDRIVE.connectionString).db,
    resolveTxt: dohResolveTxt,
    encryptionKey: env.ENCRYPTION_KEY,
    fetch: fetch.bind(globalThis),
    allowPrivateWebhooks: env.ALLOW_PRIVATE_WEBHOOKS === 'true',
    appHost: env.APP_HOST,
    scheduleDelivery: async (id, delaySeconds, trigger = 'scheduled') => {
      await env.QUEUE.send({ id, trigger }, { delaySeconds: Math.ceil(delaySeconds) });
    },
  };
}

const app = createApp((c) => makeDeps(c.env));

export default {
  fetch: app.fetch,
  async queue(batch, env) {
    const deps = makeDeps(env);
    for (const msg of batch.messages) {
      try {
        await deliver(deps, msg.body.id, msg.body.trigger);
        msg.ack();
      } catch (e) {
        console.error(e); // infrastructure failure: let Queues redeliver
        msg.retry({ delaySeconds: 60 });
      }
    }
  },
  async scheduled(_event, env) {
    await runMaintenance(makeDeps(env));
  },
} satisfies ExportedHandler<Env, QueueMessage>;
