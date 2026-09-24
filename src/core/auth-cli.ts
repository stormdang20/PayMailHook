// Only for the better-auth CLI (`auth generate`), which needs a module exporting `auth`.
// Runtime code calls createAuth() with a real database and env.
import { createAuth } from './auth';
import type { Database } from './db/client';

export const auth = createAuth({} as Database, {
  BETTER_AUTH_SECRET: 'cli-placeholder-secret-cli-placeholder',
  BETTER_AUTH_URL: 'http://localhost:3000',
  ENCRYPTION_KEY: '',
  GOOGLE_CLIENT_ID: 'cli',
  GOOGLE_CLIENT_SECRET: 'cli',
  ALLOW_SIGNUP: true,
  ALLOW_PRIVATE_WEBHOOKS: false,
});
