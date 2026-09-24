import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/** Driver-agnostic handle: postgres.js in prod, PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string) {
  const client = postgres(url, { max: 5, fetch_types: false });
  return { db: drizzle(client, { schema }) as unknown as Database, close: () => client.end() };
}
