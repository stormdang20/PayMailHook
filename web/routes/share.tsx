import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, parseResponse } from '@/lib/api';
import { formatMoney, formatTime } from '@/lib/format';

const Missing = () => (
  <PublicShell>
    <p className="text-center text-muted-foreground">Link không tồn tại hoặc đã bị thu hồi.</p>
  </PublicShell>
);

/** Public proof of one payment: /share/t/:token */
export function SharedTransactionPage() {
  const token = useParams().token ?? '';
  const txn = useQuery({
    queryKey: ['share-t', token],
    queryFn: () => parseResponse(api.share.t[':token'].$get({ param: { token } })),
    retry: false,
  });
  if (txn.isError) return <Missing />;
  const t = txn.data;
  return (
    <PublicShell>
      {t && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl tabular-nums">
              {t.direction === 'in' ? '+' : '−'}
              {formatMoney(t.amount, t.currency)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Thời gian</dt>
              <dd>{formatTime(t.occurredAt)}</dd>
              <dt className="text-muted-foreground">Ngân hàng</dt>
              <dd>{t.bank}</dd>
              <dt className="text-muted-foreground">Nội dung</dt>
              <dd className="break-all">{t.description}</dd>
              <dt className="text-muted-foreground">Mã đơn</dt>
              <dd>{t.orderId ?? '—'}</dd>
              <dt className="text-muted-foreground">Mã giao dịch</dt>
              <dd>{t.bankTxnId ?? '—'}</dd>
            </dl>
          </CardContent>
        </Card>
      )}
    </PublicShell>
  );
}

/** Public cashier screen for one Gmail's incoming money: /share/c/:token */
export function SharedListPage() {
  const token = useParams().token ?? '';
  const pages = useInfiniteQuery({
    queryKey: ['share-c', token],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      parseResponse(api.share.c[':token'].$get({ param: { token }, query: pageParam ? { cursor: pageParam } : {} })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 5000,
    retry: false,
  });
  if (pages.isError) return <Missing />;
  const rows = pages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <PublicShell>
      <h1 className="mb-4 font-semibold text-lg">Tiền vào</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Thời gian</TableHead>
            <TableHead className="text-right">Số tiền</TableHead>
            <TableHead>Nội dung</TableHead>
            <TableHead>Mã đơn</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="whitespace-nowrap">{formatTime(t.occurredAt)}</TableCell>
              <TableCell className="whitespace-nowrap text-right text-green-600 tabular-nums">
                +{formatMoney(t.amount, t.currency)}
              </TableCell>
              <TableCell className="max-w-xs truncate" title={t.description}>
                {t.description}
              </TableCell>
              <TableCell>{t.orderId ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pages.hasNextPage && (
        <Button variant="outline" className="mt-4" onClick={() => pages.fetchNextPage()}>
          Xem thêm
        </Button>
      )}
    </PublicShell>
  );
}
