// Usage: bun scripts/anonymize-fixtures.ts
// Decodes each raw .eml in mail-template/, replaces PII from mail-template/pii.json,
// strips URLs, and writes the HTML body to test/fixtures/<bank>/<n>.html.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import PostalMime from 'postal-mime';

const pii: Record<string, string> = JSON.parse(await readFile('mail-template/pii.json', 'utf8'));

// Fail instead of committing a leak: catch leftovers in any case or Unicode form.
function assertNoPii(html: string, file: string) {
  const haystack = html.toLowerCase();
  for (const real of Object.keys(pii)) {
    const forms = [real.normalize('NFC'), real.normalize('NFD')].map((s) => s.toLowerCase());
    if (forms.some((f) => haystack.includes(f)))
      throw new Error(`PII left in ${file} (value of length ${real.length})`);
  }
}

for (const bank of ['cake', 'timo', 'paypal']) {
  await mkdir(`test/fixtures/${bank}`, { recursive: true });
  const files = (await readdir(`mail-template/${bank}`)).filter((f) => f.endsWith('.eml')).sort();
  for (const [i, file] of files.entries()) {
    const email = await PostalMime.parse(await readFile(`mail-template/${bank}/${file}`));
    let html = (email.html ?? '').normalize('NFC').replace(/https?:\/\/[^\s"'<>]+/g, 'https://example.invalid');
    for (const [real, fake] of Object.entries(pii)) html = html.replaceAll(real.normalize('NFC'), fake);
    assertNoPii(html, file);
    await writeFile(`test/fixtures/${bank}/${i + 1}.html`, html);
  }
}
