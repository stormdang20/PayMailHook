import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Banks PayMailHook reads; adding one here adds it to every picker. */
export const BANK_NAMES = { CAKE: 'CAKE by VPBank', TIMO: 'Timo', PAYPAL: 'PayPal' } as const;
export type BankCode = keyof typeof BANK_NAMES;

const ALL_BANKS = Object.keys(BANK_NAMES) as BankCode[];

/** A visible checkbox on the left (the default item only shows a tick on the right once checked). */
function Box({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border border-input bg-background',
        checked && 'border-primary bg-primary text-primary-foreground',
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

const itemClass = 'gap-2 pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden';

const summary = (selected: BankCode[]) =>
  selected.length === ALL_BANKS.length ? 'Tất cả ngân hàng' : selected.map((b) => BANK_NAMES[b]).join(', ');

/**
 * Multi-select drop-down: "all banks" (default) or any subset, never none.
 * Submits one hidden `banks` input per selected bank; read them with `formBanks(form)`.
 */
export function BankPicker({ defaultValue = ALL_BANKS, id = 'banks' }: { defaultValue?: BankCode[]; id?: string }) {
  const [selected, setSelected] = useState<BankCode[]>(defaultValue);
  const allSelected = selected.length === ALL_BANKS.length;
  // The last selected bank stays ticked: a Gmail must receive from at least one bank.
  const toggle = (bank: BankCode, on: boolean) =>
    setSelected((current) =>
      on
        ? ALL_BANKS.filter((b) => b === bank || current.includes(b))
        : current.length > 1
          ? current.filter((b) => b !== bank)
          : current,
    );
  // Keep the menu open while ticking several boxes.
  const stayOpen = (e: Event) => e.preventDefault();

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Ngân hàng</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={id} type="button" variant="outline" className="w-full justify-between font-normal">
            <span className="truncate">{summary(selected)}</span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-(--radix-dropdown-menu-trigger-width)">
          <DropdownMenuCheckboxItem
            className={itemClass}
            checked={allSelected}
            onCheckedChange={() => setSelected(ALL_BANKS)}
            onSelect={stayOpen}
          >
            <Box checked={allSelected} />
            Tất cả ngân hàng
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {ALL_BANKS.map((bank) => {
            const checked = selected.includes(bank);
            return (
              <DropdownMenuCheckboxItem
                key={bank}
                className={itemClass}
                checked={checked}
                onCheckedChange={(on) => toggle(bank, on)}
                onSelect={stayOpen}
              >
                <Box checked={checked} />
                {BANK_NAMES[bank]}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {selected.map((bank) => (
        <input key={bank} type="hidden" name="banks" value={bank} />
      ))}
    </div>
  );
}

export const formBanks = (form: FormData) => form.getAll('banks').map(String) as BankCode[];
