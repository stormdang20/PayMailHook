import type { Database } from './db/client';
import type { ResolveTxt } from './dkim';

export type Trigger = 'scheduled' | 'manual';

export type Deps = {
  db: Database;
  resolveTxt: ResolveTxt;
  encryptionKey: string;
  fetch: typeof fetch;
  allowPrivateWebhooks: boolean;
  appHost: string;
  scheduleDelivery: (id: string, delaySeconds: number, trigger?: Trigger) => Promise<void>;
};
