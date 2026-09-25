import { createApp } from './api/app';
import { createAuth } from './core/auth';
import { createDb } from './core/db/client';
import type { Deps, Trigger } from './core/deps';
import { dohResolveTxt } from './core/dkim';
import { gmailPushFrom, inboundFrom, parseEnv, vapidFrom } from './core/env';
import { receiveForwarded } from './core/forwarding';
import { runMaintenance } from './core/maintenance';
import { deliver } from './core/webhook';

type QueueMessage = { id: string; trigger: Trigger };
type Bindings = { HYPERDRIVE: Hyperdrive; QUEUE: Queue<QueueMessage> } & Record<string, unknown>;
type WaitUntil = (promise: Promise<unknown>) => void;

// A new postgres.js client per invocation is what Hyperdrive recommends; it cleans the
// connection up when the invocation ends, so there is nothing to close.
function makeDeps(bindings: Bindings, waitUntil?: WaitUntil): Deps {
  const env = parseEnv(bindings);
  const { db } = createDb(bindings.HYPERDRIVE.connectionString);
  return {
    db,
    auth: createAuth(db, env, waitUntil, 'cf-connecting-ip'), // set by Cloudflare, not spoofable
    resolveTxt: dohResolveTxt,
    encryptionKey: env.ENCRYPTION_KEY,
    fetch: fetch.bind(globalThis),
    allowPrivateWebhooks: env.ALLOW_PRIVATE_WEBHOOKS,
    imapEnabled: false,
    vapid: vapidFrom(env),
    gmailPush: gmailPushFrom(env),
    inbound: inboundFrom(env),
    appUrl: env.BETTER_AUTH_URL,
    scheduleDelivery: async (id, delaySeconds, trigger = 'scheduled') => {
      await bindings.QUEUE.send({ id, trigger }, { delaySeconds: Math.ceil(delaySeconds) });
    },
  };
}

const app = createApp((c) => makeDeps(c.env, (p) => c.executionCtx.waitUntil(p)));

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
  // Forwarding source: Cloudflare Email Routing (catch-all on INBOUND_EMAIL_DOMAIN) delivers here.
  async email(message, env, ctx) {
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const result = await receiveForwarded(
      makeDeps(env, (p) => ctx.waitUntil(p)),
      message.to,
      raw,
    );
    if (result.status === 'unknown_recipient') message.setReject('Unknown address');
  },
  async scheduled(_event, env) {
    await runMaintenance(makeDeps(env));
  },
} satisfies ExportedHandler<Bindings, QueueMessage>;
