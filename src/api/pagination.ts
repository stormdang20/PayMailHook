import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';

type Cursor = { ts: string; id: string };

const encode = (c: Cursor) => new TextEncoder().encode(JSON.stringify(c)).toBase64({ alphabet: 'base64url' });
const cursorShape = z.object({ ts: z.string().max(40), id: z.uuid() });

function decode(raw: string): Cursor | null {
  try {
    const parsed = cursorShape.safeParse(
      JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(raw, { alphabet: 'base64url' }))),
    );
    return parsed.success && !Number.isNaN(Date.parse(parsed.data.ts)) ? parsed.data : null;
  } catch (e) {
    if (e instanceof SyntaxError) return null; // not base64 or not JSON
    throw e;
  }
}

/** `?cursor=&limit=` for keyset pagination; a malformed cursor fails validation (400). */
export const pageQuery = {
  cursor: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return undefined;
      const cursor = decode(raw);
      if (!cursor) ctx.addIssue({ code: 'custom', message: 'invalid cursor' });
      return cursor ?? undefined;
    }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

/**
 * Newest-first keyset on (timestamp, id). The cursor keeps Postgres' own text form of the
 * timestamp: it has microseconds, which a JS Date would round off and so skip or repeat rows.
 */
export const keyset = (ts: AnyColumn, id: AnyColumn) => ({
  select: { cursorTs: sql<string>`${ts}::text` },
  before: (c: Cursor | undefined): SQL | undefined =>
    c ? sql`(${ts}, ${id}) < (${c.ts}::timestamptz, ${c.id}::uuid)` : undefined,
  page<T extends { cursorTs: string; id: string }>(rows: T[], limit: number) {
    const items = rows.slice(0, limit).map(({ cursorTs: _, ...rest }) => rest);
    const last = rows[limit - 1];
    return { items, nextCursor: rows.length > limit && last ? encode({ ts: last.cursorTs, id: last.id }) : null };
  },
});
