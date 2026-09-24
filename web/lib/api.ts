import { hc } from 'hono/client';
import type { AppType } from '../../src/api/app';

export { parseResponse } from 'hono/client';

/** Typed client for the Hono API; same origin, so the session cookie goes along. */
export const api = hc<AppType>('/').api;
