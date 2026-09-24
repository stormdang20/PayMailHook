import { and, inArray, lt, sql } from 'drizzle-orm';
import { webhookDeliveries } from './db/schema';
import type { Deps } from './deps';
import { renewGmailWatches } from './gmail-oauth';

/** Hourly: re-enqueue stuck deliveries and prune old rows in bounded batches (design §3.5). */
export async function runMaintenance(deps: Deps) {
  const stuck = await deps.db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        inArray(webhookDeliveries.status, ['pending', 'retrying']),
        lt(webhookDeliveries.nextAttemptAt, sql`now() - interval '2 minutes'`),
      ),
    )
    .limit(100);
  for (const { id } of stuck) await deps.scheduleDelivery(id, 0);
  await deps.db.execute(sql`delete from webhook_deliveries where id in (select id from webhook_deliveries
    where status in ('success','failed') and created_at < now() - interval '30 days' limit 1000)`);
  await deps.db.execute(sql`delete from inbound_failures where id in (select id from inbound_failures
    where created_at < now() - interval '7 days' limit 1000)`);
  await renewGmailWatches(deps);
  await deps.db.execute(sql`delete from email_configs where id in (select id from email_configs
    where last_ingest_at is null and created_at < now() - interval '7 days' limit 1000)`);
}
