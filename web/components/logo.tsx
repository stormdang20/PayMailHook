import { cn } from '@/lib/utils';

/** Mark: the bank's notification email (envelope) stamped as paid (tick badge). Same art as public/logo.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill="#0E6E5C" />
      <rect x="5" y="8" width="18.5" height="13.5" rx="2.2" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M5.8 9.2l8.45 6.3 8.45-6.3" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="23.2" cy="21.6" r="6.2" fill="#F2B705" stroke="#0E6E5C" strokeWidth="2" />
      <path
        d="M20.6 21.7l1.8 1.8 3.4-3.7"
        fill="none"
        stroke="#0E6E5C"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold text-[1.05rem] tracking-tight', className)}>
      <LogoMark />
      <span>
        PayMail<span className="text-primary">Hook</span>
      </span>
    </span>
  );
}
