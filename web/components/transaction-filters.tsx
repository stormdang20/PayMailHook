import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { BANK_NAMES, type BankCode } from '@/components/bank-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, parseResponse } from '@/lib/api';

const KEYS = ['q', 'from', 'to', 'bank', 'configId', 'direction', 'hasOrder', 'minAmount', 'maxAmount'] as const;
type Key = (typeof KEYS)[number];
export type Filters = Partial<Record<Key, string>>;

/** Filters live in the URL, so a reload, the back button or a shared link keeps them. */
export function useTransactionFilters() {
  const [params, setParams] = useSearchParams();
  const filters: Filters = Object.fromEntries(KEYS.flatMap((k) => (params.get(k) ? [[k, params.get(k)]] : [])));
  const set = (key: Key, value: string | undefined) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const reset = () => setParams({}, { replace: true });
  return { filters, set, reset, active: Object.keys(filters).length > 0 };
}

const ALL = 'all';

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: [string, string][];
}) {
  return (
    // min-w-0 lets a long value (a Gmail address) shrink to the grid column instead of widening it.
    <div className="grid min-w-0 gap-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
        <SelectTrigger
          className="w-full *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
          aria-label={label}
          title={options.find(([v]) => v === value)?.[1]}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tất cả</SelectItem>
          {options.map(([v, text]) => (
            <SelectItem key={v} value={v}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function TransactionFilters({ filters, set, reset, active }: ReturnType<typeof useTransactionFilters>) {
  const configs = useQuery({ queryKey: ['email-configs'], queryFn: () => parseResponse(api['email-configs'].$get()) });
  // Search waits for a pause in typing instead of querying on every keystroke.
  const [text, setText] = useState(filters.q ?? '');
  useEffect(() => setText(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    const timer = setTimeout(() => text.trim() !== (filters.q ?? '') && set('q', text.trim() || undefined), 300);
    return () => clearTimeout(timer);
  });
  const field = (key: Key, label: string, props: React.ComponentProps<typeof Input>) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`f-${key}`} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Input
        id={`f-${key}`}
        value={filters[key] ?? ''}
        onChange={(e) => set(key, e.target.value || undefined)}
        {...props}
      />
    </div>
  );

  return (
    <div className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="relative sm:col-span-2 lg:col-span-4">
        <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
        <Input
          aria-label="Tìm theo nội dung, mã đơn hoặc tên người chuyển"
          placeholder="Tìm theo nội dung chuyển khoản, mã đơn, tên người chuyển"
          className="pl-8"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {field('from', 'Từ ngày', { type: 'date', max: filters.to })}
      {field('to', 'Đến ngày', { type: 'date', min: filters.from })}
      <Choice
        label="Ngân hàng"
        value={filters.bank}
        onChange={(v) => set('bank', v)}
        options={(Object.keys(BANK_NAMES) as BankCode[]).map((b) => [b, BANK_NAMES[b]])}
      />
      <Choice
        label="Gmail"
        value={filters.configId}
        onChange={(v) => set('configId', v)}
        options={(configs.data ?? []).map((c) => [c.id, c.gmail])}
      />
      <Choice
        label="Loại"
        value={filters.direction}
        onChange={(v) => set('direction', v)}
        options={[
          ['in', 'Tiền vào'],
          ['out', 'Tiền ra'],
        ]}
      />
      <Choice
        label="Mã đơn"
        value={filters.hasOrder}
        onChange={(v) => set('hasOrder', v)}
        options={[['true', 'Chỉ có mã đơn']]}
      />
      {field('minAmount', 'Số tiền từ (đ)', { type: 'number', min: 0, step: 1000, inputMode: 'numeric' })}
      {field('maxAmount', 'Số tiền đến (đ)', { type: 'number', min: 0, step: 1000, inputMode: 'numeric' })}
      {active && (
        <div className="flex justify-end sm:col-span-2 lg:col-span-4">
          <Button variant="ghost" size="sm" onClick={reset}>
            <X />
            Xoá bộ lọc
          </Button>
        </div>
      )}
    </div>
  );
}
