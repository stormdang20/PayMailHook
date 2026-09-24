import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** An empty list says what goes here and how to get it there. */
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-card px-6 py-12 text-center">
      <Icon className="size-8 text-primary" strokeWidth={1.5} />
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-muted-foreground text-sm">{children}</div>}
    </div>
  );
}
