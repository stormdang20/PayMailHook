import type { Auth } from './auth';
import type { Database } from './db/client';
import type { ResolveTxt } from './dkim';

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
  /** Public origin, e.g. https://paymailhook.example.workers.dev */
  appUrl: string;
  scheduleDelivery: (id: string, delaySeconds: number, trigger?: Trigger) => Promise<void>;
};
