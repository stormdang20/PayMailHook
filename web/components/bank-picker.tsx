import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const BANK_NAMES = { CAKE: 'CAKE by VPBank', TIMO: 'Timo' } as const;
export type BankCode = keyof typeof BANK_NAMES;

const ALL = 'ALL';
const ALL_BANKS = Object.keys(BANK_NAMES) as BankCode[];

/** Drop-down named `banks`: every bank (default) or just one. Read it with `formBanks(form)`. */
export function BankPicker({ defaultValue = ALL_BANKS, id = 'banks' }: { defaultValue?: BankCode[]; id?: string }) {
  const initial = defaultValue.length === 1 ? defaultValue[0] : ALL;
  return (
    // grid gap, not space-y: Radix adds a hidden native <select> after the trigger, and space-y would give it a margin.
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Ngân hàng</Label>
      <Select name="banks" defaultValue={initial}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tất cả ngân hàng</SelectItem>
          {ALL_BANKS.map((code) => (
            <SelectItem key={code} value={code}>
              {BANK_NAMES[code]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export const formBanks = (form: FormData): BankCode[] => {
  const value = String(form.get('banks') ?? ALL);
  return value === ALL ? ALL_BANKS : [value as BankCode];
};
