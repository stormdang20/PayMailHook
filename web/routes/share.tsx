import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, parseResponse } from '@/lib/api';
import { formatTime, formatVnd } from '@/lib/format';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {children}
      <p className="mt-6 text-center text-muted-foreground text-xs">Chia sẻ qua PayMailHook</p>
    </div>
  );
}

const Missing = () => (
  <Shell>
    <p className="text-center text-muted-foreground">Link không tồn tại hoặc đã bị thu hồi.</p>
  </Shell>
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
    <Shell>
      {t && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl tabular-nums">
              {t.direction === 'in' ? '+' : '−'}
              {formatVnd(t.amount)}
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
    </Shell>
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
    <Shell>
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
                +{formatVnd(t.amount)}
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
    </Shell>
  );
}
