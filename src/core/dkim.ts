import type { DKIMResult } from 'mailauth';
import { dkimVerify } from 'mailauth/lib/dkim/verify';
import type { Bank } from './banks';

export type ResolveTxt = (name: string, rrtype: string) => Promise<string[][]>;

/** Fields mailauth returns at runtime but leaves out of its DKIMResult type. */
type VerifiedSignature = DKIMResult & { signingHeaders?: { keys: string }; canonBodyLengthLimited?: boolean };

const REQUIRED_SIGNED = ['from', 'to'];

async function hasTrustedSignature(raw: Uint8Array, bank: Bank, resolver: ResolveTxt) {
  const verified = await dkimVerify(Buffer.from(raw), { resolver });
  // A verifier checks only the bottom-most copy of a header, while parsers read the top one.
  // An extra unsigned To/From would keep the signature valid but change what ingest sees.
  const headerKeys = verified.headers?.parsed.map((h) => h.key) ?? [];
  if (REQUIRED_SIGNED.some((k) => headerKeys.filter((h) => h === k).length !== 1)) return false;
  const results: VerifiedSignature[] = verified.results;
  return results.some((r) => {
    const signed = String(r.signingHeaders?.keys ?? '')
      .toLowerCase()
      .split(':')
      .map((h) => h.trim());
    return (
      r.status?.result === 'pass' &&
      r.signingDomain === bank.dkimDomain &&
      REQUIRED_SIGNED.every((h) => signed.includes(h)) &&
      !r.canonBodyLengthLimited
    );
  });
}

/** Drops every Date header (incl. folded lines) from the header block. */
function stripDateHeader(raw: Uint8Array) {
  const s = Buffer.from(raw).toString('latin1');
  const split = s.indexOf('\r\n\r\n');
  const head = s.slice(0, split + 2).replace(/^Date:.*\r\n(?:[ \t].*\r\n)*/gim, '');
  return new Uint8Array(Buffer.from(head + s.slice(split + 2), 'latin1'));
}

export async function verifyBankDkim(raw: Uint8Array, bank: Bank, resolver: ResolveTxt) {
  if (await hasTrustedSignature(raw, bank, resolver)) return true;
  return bank.gmailAddsDate === true && hasTrustedSignature(stripDateHeader(raw), bank, resolver);
}

/** DNS-over-HTTPS TXT lookup; works on Workers and Bun alike (Bun's node:dns TXT shape broke mailauth, research §3). */
export const dohResolveTxt: ResolveTxt = async (name) => {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: 'application/dns-json' },
  });
  if (!res.ok) throw new Error(`doh ${res.status}`);
  const { Answer = [] } = (await res.json()) as { Answer?: { type: number; data: string }[] };
  const txt = Answer.filter((a) => a.type === 16);
  if (!txt.length) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return txt.map((a) => [a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, '')]);
};
