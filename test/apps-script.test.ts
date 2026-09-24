import { expect, test } from 'bun:test';

const code = await Bun.file('apps-script/Code.gs').text();

type FakeMessage = { getDate: () => Date; getRawContent: () => string };
type FakeResponse = { code: number; body: string };
type Request = { url: string; payload: string; headers: Record<string, string> };

const message = (secondsAgo: number, id: string): FakeMessage => ({
  getDate: () => new Date(Date.now() - secondsAgo * 1000),
  getRawContent: () => id,
});

/** Runs Code.gs against fake Apps Script services. `threads` are returned newest first, like Gmail. */
function load(threads: FakeMessage[][], respond: (r: Request) => FakeResponse, cursor: number) {
  const props = new Map([['cursor', String(cursor)]]);
  const sent: Request[] = [];
  const GmailApp = {
    search: (_q: string, start: number, max: number) =>
      threads.slice(start, start + max).map((messages) => ({ getMessages: () => messages })),
  };
  const UrlFetchApp = {
    fetchAll: (requests: Request[]) =>
      requests.map((r) => {
        sent.push(r);
        const res = respond(r);
        return { getResponseCode: () => res.code, getContentText: () => res.body };
      }),
  };
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k: string) => props.get(k) ?? null,
      setProperty: (k: string, v: string) => props.set(k, v),
    }),
  };
  const LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  const factory = new Function(
    'GmailApp',
    'UrlFetchApp',
    'PropertiesService',
    'LockService',
    'ScriptApp',
    `${code}; return { poll };`,
  );
  const { poll } = factory(GmailApp, UrlFetchApp, PropertiesService, LockService, {});
  return { poll, sent, cursor: () => Number(props.get('cursor')) };
}

const now = () => Math.floor(Date.now() / 1000);
const ok = () => ({ code: 200, body: '{"ok":true,"status":"stored"}' });

test('advances the cursor to the newest message when every response is ok', () => {
  const start = now() - 3600;
  const s = load([[message(10, 'b')], [message(60, 'a')]], ok, start);
  s.poll();
  expect(s.sent.map((r) => r.payload).sort()).toEqual(['a', 'b']);
  expect(s.sent[0].headers.Authorization).toBe('Bearer {{INGEST_TOKEN}}');
  expect(s.cursor()).toBeGreaterThanOrEqual(now() - 11);
});

test('keeps the cursor when any response is a 5xx', () => {
  const start = now() - 3600;
  const s = load(
    [[message(10, 'b')], [message(60, 'a')]],
    (r) => (r.payload === 'a' ? { code: 500, body: '' } : ok()),
    start,
  );
  s.poll();
  expect(s.cursor()).toBe(start);
});

test('keeps the cursor when a 200 body is not JSON', () => {
  const start = now() - 3600;
  const s = load([[message(10, 'a')]], () => ({ code: 200, body: '<html>proxy</html>' }), start);
  s.poll();
  expect(s.cursor()).toBe(start);
});

test('sends every message of a thread, not just the thread', () => {
  const s = load([[message(20, 'a'), message(10, 'b')]], ok, now() - 3600);
  s.poll();
  expect(s.sent).toHaveLength(2);
});

test('skips messages older than the overlap window', () => {
  const s = load([[message(7200, 'old'), message(10, 'new')]], ok, now() - 60);
  s.poll();
  expect(s.sent.map((r) => r.payload)).toEqual(['new']);
});

test('pages through a backlog larger than one search page', () => {
  const threads = Array.from({ length: 120 }, (_, i) => [message(10 + i, `m${i}`)]);
  const s = load(threads, ok, now() - 3600);
  s.poll();
  expect(s.sent).toHaveLength(120);
});
