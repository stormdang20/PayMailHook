import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from '../src/core/db/client';
import * as schema from '../src/core/db/schema';

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'migrations' });
  return { db: db as unknown as Database, close: () => client.close() };
}

export async function seedConfig(db: Database, overrides: Partial<schema.EmailConfig> = {}) {
  const userId = crypto.randomUUID();
  await db
    .insert(schema.user)
    .values({ id: userId, name: 'Test', email: `${userId}@test.local`, emailVerified: false, createdAt: new Date() });
  const [config] = await db
    .insert(schema.emailConfigs)
    .values({ userId, gmail: 'owner@gmail.com', ingestTokenHash: crypto.randomUUID(), ...overrides })
    .returning();
  return config;
}
