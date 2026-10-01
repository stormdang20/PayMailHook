import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ReceiptText, SearchX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { EmptyState } from '@/components/empty-state';
import { OrderCode } from '@/components/order-code';
import { PageHeader } from '@/components/page-header';
import { ShareButton } from '@/components/share-button';
import { TransactionFilters, useTransactionFilters } from '@/components/transaction-filters';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, parseResponse } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatMoney, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export function TransactionsPage() {
  const filterState = useTransactionFilters();
  const { filters } = filterState;
  const filter = JSON.stringify(filters);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['transactions'] });
  const pages = useInfiniteQuery({
    queryKey: ['transactions', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      parseResponse(
        api.transactions.$get({
          // Values come from the URL; the API validates them (a bad date is a 400).
          query: { ...(filters as Record<string, string>), ...(pageParam && { cursor: pageParam }) },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Near-realtime while the tab is visible; TanStack pauses interval refetches for hidden tabs,
    // so an idle dashboard lets Neon scale to zero.
    refetchInterval: 5000,
  });
  const rows = pages.data?.pages.flatMap((p) => p.items) ?? [];
  // Rows that arrived while the page was open get a brief highlight; the first load and filter switches don't.
  const seen = useRef(new Map<string, Set<string>>());
  const isFresh = (id: string) => seen.current.get(filter)?.has(id) === false;
  useEffect(() => {
    if (!pages.data) return;
    const ids = seen.current.get(filter) ?? new Set<string>();
    for (const page of pages.data.pages) for (const t of page.items) ids.add(t.id);
    seen.current.set(filter, ids);
  }, [pages.data, filter]);

  return (
    <div>
      <PageHeader
        title="Giao dịch"
        description="Mọi biến động số dư đọc được từ email ngân hàng, tự cập nhật mỗi 5 giây."
        actions={
          <span className="flex items-center gap-2 text-muted-foreground text-xs">
            <span className="size-2 animate-live rounded-full bg-primary motion-reduce:animate-none" />
            Đang cập nhật
          </span>
        }
      />
      <TransactionFilters {...filterState} />
      {pages.error && <p className="mb-4 text-destructive text-sm">{errorMessage(pages.error)}</p>}
      {pages.isSuccess && rows.length === 0 ? (
        filterState.active ? (
          <EmptyState icon={SearchX} title="Không có giao dịch khớp bộ lọc">
            Thử nới khoảng thời gian hoặc bấm Xoá bộ lọc.
          </EmptyState>
        ) : (
          <EmptyState icon={ReceiptText} title="Chưa có giao dịch">
            Giao dịch xuất hiện ở đây vài giây sau khi ngân hàng gửi email thông báo tới Gmail đã kết nối.
          </EmptyState>
        )
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thời gian</TableHead>
                <TableHead>Ngân hàng</TableHead>
                <TableHead className="text-right">Số tiền</TableHead>
                <TableHead>Nội dung</TableHead>
                <TableHead>Mã đơn</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} className={isFresh(t.id) ? 'animate-fresh motion-reduce:animate-none' : undefined}>
                  <TableCell className="whitespace-nowrap">{formatTime(t.occurredAt)}</TableCell>
                  <TableCell>{t.bank}</TableCell>
                  <TableCell
                    className={cn(
                      'whitespace-nowrap text-right tabular-nums',
                      t.direction === 'in' ? 'font-medium text-primary' : 'text-destructive',
                    )}
                  >
                    {t.direction === 'in' ? '+' : '−'}
                    {formatMoney(t.amount, t.currency)}
                  </TableCell>
                  <TableCell className="max-w-md truncate" title={t.description}>
                    {t.description}
                  </TableCell>
                  <TableCell>
                    <OrderCode code={t.orderId} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ShareButton
                      label="Chia sẻ"
                      description="Ai có link đều xem được số tiền, thời gian, nội dung và mã đơn của giao dịch này (không có thông tin người chuyển)."
                      token={t.shareToken}
                      pathFor={(token) => `/share/t/${token}`}
                      share={() => parseResponse(api.transactions[':id'].share.$post({ param: { id: t.id } }))}
                      revoke={() => api.transactions[':id'].share.$delete({ param: { id: t.id } })}
                      onChange={refresh}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {pages.hasNextPage && (
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => pages.fetchNextPage()}
          disabled={pages.isFetchingNextPage}
        >
          Xem thêm
        </Button>
      )}
    </div>
  );
}
