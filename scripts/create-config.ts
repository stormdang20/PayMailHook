// Usage: bun scripts/create-config.ts <gmail> <webhookUrl> [ingestUrl]
// Creates a dev user and an email config, then prints the ingest token, the webhook secret
// and a ready-to-paste Code.gs. For testing P1 by hand before the dashboard exists.
import { renderAppsScript } from '../src/core/apps-script';
import { encryptText, randomToken, sha256Hex } from '../src/core/crypto';
import { createDb } from '../src/core/db/client';
import { emailConfigs, user } from '../src/core/db/schema';
import { newWebhookSecret, validateWebhookUrl } from '../src/core/webhook';

const [gmail, webhookUrl, ingestUrl = 'http://localhost:3000/api/ingest'] = process.argv.slice(2);
const { DATABASE_URL, ENCRYPTION_KEY, BETTER_AUTH_URL = 'http://localhost', ALLOW_PRIVATE_WEBHOOKS } = process.env;
if (!gmail || !webhookUrl || !DATABASE_URL || !ENCRYPTION_KEY) {
  console.error(
    'Usage: bun scripts/create-config.ts <gmail> <webhookUrl> [ingestUrl]  (needs DATABASE_URL, ENCRYPTION_KEY)',
  );
  process.exit(1);
}
const urlError = validateWebhookUrl(webhookUrl, {
  allowPrivate: ALLOW_PRIVATE_WEBHOOKS !== 'false',
  appHost: new URL(BETTER_AUTH_URL).host,
});
if (urlError) throw new Error(`webhook url rejected: ${urlError}`);

const { db, close } = createDb(DATABASE_URL);
const token = randomToken();
const secret = newWebhookSecret();
const userId = crypto.randomUUID();
await db
  .insert(user)
  .values({ id: userId, name: 'Dev', email: `dev+${userId}@paymailhook.local`, createdAt: new Date() });
await db.insert(emailConfigs).values({
  userId,
  gmail: gmail.trim().toLowerCase(),
  ingestTokenHash: await sha256Hex(token),
  webhookUrl,
  webhookSecretEnc: await encryptText(ENCRYPTION_KEY, secret),
});
await close();

console.log(`Ingest token:   ${token}\nWebhook secret: ${secret}\n\n----- Code.gs -----\n`);
console.log(renderAppsScript(ingestUrl, token));
