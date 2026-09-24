import type { Auth } from './auth';
import type { Database } from './db/client';
import type { ResolveTxt } from './dkim';
import type { GmailPush } from './gmail-oauth';
import type { Vapid } from './push';

export type Trigger = 'scheduled' | 'manual';

export type Deps = {
  db: Database;
  auth: Auth;
  resolveTxt: ResolveTxt;
  encryptionKey: string;
  fetch: typeof fetch;
  allowPrivateWebhooks: boolean;
  /** Self-host only: Workers cannot hold long-lived IMAP connections. */
  imapEnabled: boolean;
  /** Web Push keys; push is off when absent. */
  vapid?: Vapid;
  /** Gmail OAuth source; off when absent. */
  gmailPush?: GmailPush;
  /** Public origin, e.g. https://paymailhook.example.workers.dev */
  appUrl: string;
  scheduleDelivery: (id: string, delaySeconds: number, trigger?: Trigger) => Promise<void>;
};
