import { expect, test } from 'bun:test';
import { createTestDb, seedConfig } from './db';

test('same gmail may exist twice until one of them is claimed', async () => {
  const { db, close } = await createTestDb();
  await seedConfig(db, { lastIngestAt: new Date() });
  await seedConfig(db); // unclaimed duplicate is allowed
  await expect(seedConfig(db, { lastIngestAt: new Date() })).rejects.toThrow();
  await close();
});
