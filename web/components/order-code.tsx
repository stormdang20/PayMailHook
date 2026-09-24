/** An order code, highlighted like a marker on a bank slip: the thing a shop owner scans for. */
export function OrderCode({ code }: { code: string | null }) {
  if (!code) return <span className="text-muted-foreground">—</span>;
  return <mark className="rounded bg-highlight/35 px-1.5 py-0.5 font-medium text-foreground tabular-nums">{code}</mark>;
}
