import { z } from 'zod';

/** Unset and empty (`FOO=` copied from .env.example) both mean "not configured". */
const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const flag = (fallback: boolean) =>
  z
    .preprocess((v) => (v === '' || v === undefined ? String(fallback) : v), z.enum(['true', 'false']))
    .transform((v) => v === 'true');

function isAesKey(value: string) {
  try {
    return Uint8Array.fromBase64(value).length === 32;
  } catch (e) {
    if (e instanceof SyntaxError) return false;
    throw e;
  }
}

const schema = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    ENCRYPTION_KEY: z.string().refine(isAesKey, 'must be 32 random bytes in base64 (openssl rand -base64 32)'),
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    ALLOW_SIGNUP: flag(true),
    ALLOW_PRIVATE_WEBHOOKS: flag(false),
  })
  // Like react-starter-kit: one Google credential without the other is a broken deploy, not "Google off".
  .refine(
    (e) => !e.GOOGLE_CLIENT_ID === !e.GOOGLE_CLIENT_SECRET,
    'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
  );

export type Env = z.infer<typeof schema>;

/** Validated on first use, not at module load: Workers only has `env` inside a handler (design §4.5). */
export const parseEnv = (raw: Record<string, unknown>): Env => schema.parse(raw);

export const appHost = (env: Env) => new URL(env.BETTER_AUTH_URL).host;
