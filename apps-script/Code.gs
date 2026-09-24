// PayMailHook ingest script. Paste into script.google.com, then run setup() once.
const INGEST_URL = '{{INGEST_URL}}';
const INGEST_TOKEN = '{{INGEST_TOKEN}}';
const SENDERS = ['no-reply@cake.vn', 'support@timo.vn'];
const OVERLAP_SECONDS = 300; // re-sending is safe: the server dedupes by Message-ID
const PAGE_SIZE = 50;

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('poll').timeBased().everyMinutes(1).create();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('cursor')) props.setProperty('cursor', String(Math.floor(Date.now() / 1000)));
}

function isAck(response) {
  if (response.getResponseCode() !== 200) return false;
  try {
    return JSON.parse(response.getContentText()).ok === true;
  } catch (e) {
    if (e instanceof SyntaxError) return false;
    throw e;
  }
}

// Gmail returns threads newest first, so read every page: stopping at one page would move the
// cursor past older threads that were never sent.
function findMessages(since) {
  const query = `from:(${SENDERS.join(' OR ')}) after:${since}`;
  const messages = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const threads = GmailApp.search(query, start, PAGE_SIZE);
    for (const thread of threads) {
      // per message, not per thread
      for (const m of thread.getMessages()) if (m.getDate().getTime() / 1000 > since) messages.push(m);
    }
    if (threads.length < PAGE_SIZE) return messages;
  }
}

function poll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const messages = findMessages(Number(props.getProperty('cursor')) - OVERLAP_SECONDS);
    if (messages.length === 0) return;
    const responses = UrlFetchApp.fetchAll(
      messages.map((m) => ({
        url: INGEST_URL,
        method: 'post',
        contentType: 'message/rfc822',
        muteHttpExceptions: true,
        headers: { Authorization: `Bearer ${INGEST_TOKEN}` },
        payload: m.getRawContent(),
      })),
    );
    if (!responses.every(isAck)) return; // keep cursor; next run retries
    const newest = Math.max(...messages.map((m) => Math.floor(m.getDate().getTime() / 1000)));
    props.setProperty('cursor', String(Math.max(Number(props.getProperty('cursor')), newest)));
  } finally {
    lock.releaseLock();
  }
}
