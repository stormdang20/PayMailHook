export const BANK_NAMES = { CAKE: 'CAKE by VPBank', TIMO: 'Timo' } as const;
export type BankCode = keyof typeof BANK_NAMES;

/** Checkboxes named `banks`; read them with `formBanks(form)`. */
export function BankPicker({ defaultValue = [] }: { defaultValue?: BankCode[] }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="font-medium text-sm">Ngân hàng gửi thông báo tới Gmail này</legend>
      <div className="flex flex-wrap gap-2 pt-1.5">
        {(Object.keys(BANK_NAMES) as BankCode[]).map((code) => (
          <label
            key={code}
            className="flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm has-checked:border-primary has-checked:bg-accent"
          >
            <input
              type="checkbox"
              name="banks"
              value={code}
              defaultChecked={defaultValue.includes(code)}
              className="size-4 accent-primary"
            />
            {BANK_NAMES[code]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export const formBanks = (form: FormData) => form.getAll('banks').map(String) as BankCode[];
