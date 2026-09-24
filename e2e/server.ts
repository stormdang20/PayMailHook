// E2E-only entry: the real app on in-memory PGlite, with a test DKIM key and a fake webhook receiver.
// Never used in production: `bun e2e/server.ts` (started by playwright.config.ts).
import { serveStatic } from 'hono/bun';
import { createApp } from '../src/api/app';
import { createAuth } from '../src/core/auth';
import type { Deps } from '../src/core/deps';
import { parseEnv } from '../src/core/env';
import { deliver } from '../src/core/webhook';
import { createTestDb } from '../test/db';
import { signedEmail, testResolver } from '../test/email';

export const E2E_PORT = 4455;
const env = parseEnv({
  BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-00',
  BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
  ENCRYPTION_KEY: new Uint8Array(32).fill(1).toBase64(),
  ALLOW_PRIVATE_WEBHOOKS: 'true',
});
const { db } = await createTestDb();
const deps: Deps = {
  db,
  auth: createAuth(db, env),
  resolveTxt: testResolver,
  encryptionKey: env.ENCRYPTION_KEY,
  fetch,
  allowPrivateWebhooks: true,
  imapEnabled: false,
  appUrl: env.BETTER_AUTH_URL,
  scheduleDelivery: async (id, delaySeconds, trigger) => {
    setTimeout(() => deliver(deps, id, trigger).catch(console.error), delaySeconds * 1000);
  },
};
const cakeIncoming = await Bun.file('test/fixtures/cake/2.html').text(); // +149.000 đ, "PMH123456"

const app = createApp(() => deps);
// A bank email signed with the key testResolver knows, addressed to ?to=.
app.get('/__e2e/signed-email', async (c) => {
  const to = c.req.query('to') ?? '';
  const raw = await signedEmail({ from: 'no-reply@cake.vn', to, html: cakeIncoming, domain: 'cake.vn' });
  return c.body(raw, 200, { 'content-type': 'message/rfc822' });
});
app.post('/__e2e/hook', (c) => c.text('ok'));
const spa = serveStatic({ path: './dist/client/index.html' });
app.use('*', serveStatic({ root: './dist/client' }));
app.use('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : spa(c, next)));

export default { port: E2E_PORT, fetch: app.fetch };
