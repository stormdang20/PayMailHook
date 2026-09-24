import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { sha256Hex } from '../core/crypto';
import { emailConfigs } from '../core/db/schema';
import type { Deps } from '../core/deps';
import { ingestRawEmail } from '../core/ingest';

export type AppEnv = { Variables: { deps: Deps } };

export function createApp(makeDeps: (c: Context) => Deps) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: { code: 'internal' } }, 500);
  });

  app.use('*', async (c, next) => {
    c.set('deps', makeDeps(c));
    await next();
  });

  app.post('/api/ingest', async (c) => {
    const { deps } = c.var;
    const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    const [config] = token
      ? await deps.db
          .select()
          .from(emailConfigs)
          .where(eq(emailConfigs.ingestTokenHash, await sha256Hex(token)))
      : [];
    if (!config) return c.json({ error: { code: 'unauthorized' } }, 401);
    const result = await ingestRawEmail(deps, config, new Uint8Array(await c.req.arrayBuffer()));
    return c.json({ ok: true, ...result });
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
