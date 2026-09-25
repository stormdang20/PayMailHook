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
    VAPID_PUBLIC_KEY: optional,
    VAPID_PRIVATE_KEY: optional,
    GOOGLE_PUBSUB_TOPIC: optional,
    GOOGLE_PUBSUB_VERIFICATION_TOKEN: optional,
    INBOUND_EMAIL_DOMAIN: optional,
    INBOUND_WEBHOOK_SECRET: optional,
  })
  // Like react-starter-kit: one Google credential without the other is a broken deploy, not "Google off".
  .refine(
    (e) => !e.GOOGLE_CLIENT_ID === !e.GOOGLE_CLIENT_SECRET,
    'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
  )
  .refine(
    (e) => !e.VAPID_PUBLIC_KEY === !e.VAPID_PRIVATE_KEY,
    'set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither',
  )
  .refine(
    (e) => !e.GOOGLE_PUBSUB_TOPIC || (e.GOOGLE_PUBSUB_VERIFICATION_TOKEN && e.GOOGLE_CLIENT_ID),
    'GOOGLE_PUBSUB_TOPIC needs GOOGLE_PUBSUB_VERIFICATION_TOKEN and Google sign-in (GOOGLE_CLIENT_ID/SECRET)',
  );

export type Env = z.infer<typeof schema>;

/** Validated on first use, not at module load: Workers only has `env` inside a handler (design §4.5). */
export const parseEnv = (raw: Record<string, unknown>): Env => schema.parse(raw);

/** Web Push config; the VAPID subject is the app's own URL (RFC 8292 accepts an https URL). */
export const vapidFrom = (env: Env) =>
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.BETTER_AUTH_URL }
    : undefined;

/** Gmail OAuth source config (P4); off unless a Pub/Sub topic is set. */
export const gmailPushFrom = (env: Env) =>
  env.GOOGLE_PUBSUB_TOPIC && env.GOOGLE_PUBSUB_VERIFICATION_TOKEN
    ? { topic: env.GOOGLE_PUBSUB_TOPIC, verificationToken: env.GOOGLE_PUBSUB_VERIFICATION_TOKEN }
    : undefined;

/** Forwarding source config; off unless an inbound mail domain is set. */
export const inboundFrom = (env: Env) =>
  env.INBOUND_EMAIL_DOMAIN ? { domain: env.INBOUND_EMAIL_DOMAIN, secret: env.INBOUND_WEBHOOK_SECRET } : undefined;
