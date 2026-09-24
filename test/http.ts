import { expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from '../src/api/app';
import type { Database } from '../src/core/db/client';
import { user } from '../src/core/db/schema';

export const ORIGIN = 'http://app.test';
type App = ReturnType<typeof createApp>;

/** Signs up through the real HTTP endpoint and returns the session cookie. */
export async function signUp(app: App, db: Database, email = 'a@test.dev') {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password: 'correct-horse-battery', name: 'A' }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return { cookie, userId: row.id };
}

/** JSON request as a signed-in browser (same origin). */
export const call = (app: App, cookie: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { cookie, origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Response body as an untyped value (Bun and Workers typings disagree on Response.json()). */
// biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary JSON shapes
export const json = async (res: Response): Promise<any> => res.json();
