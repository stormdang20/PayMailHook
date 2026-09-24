import {
  BookOpen,
  KeyRound,
  LogOut,
  type LucideIcon,
  Mailbox,
  QrCode,
  ReceiptText,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import { Navigate, NavLink, Outlet } from 'react-router';
import { Logo } from '@/components/logo';
import { PushToggle } from '@/components/push-toggle';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Item = { to: string; label: string; icon: LucideIcon };

const NAV: Item[] = [
  { to: '/', label: 'Kết nối', icon: Mailbox },
  { to: '/transactions', label: 'Giao dịch', icon: ReceiptText },
  { to: '/deliveries', label: 'Webhook', icon: Webhook },
  { to: '/qr', label: 'Mã QR', icon: QrCode },
  { to: '/api-keys', label: 'API key', icon: KeyRound },
  { to: '/docs', label: 'Tài liệu', icon: BookOpen },
];
const ADMIN: Item = { to: '/admin', label: 'Quản trị', icon: ShieldCheck };

function NavItem({ item }: { item: Item }) {
  return (
    <NavLink
      to={item.to}
      end
      className={({ isActive }) =>
        cn(
          'flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          isActive && 'bg-accent font-medium text-accent-foreground',
        )
      }
    >
      <item.icon className="size-4" />
      {item.label}
    </NavLink>
  );
}

/** Signed-in shell: sidebar on desktop, a scrolling tab bar on phones. Redirects to /sign-in without a session. */
export function Layout() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/sign-in" replace />;
  const items = session.user.role === 'admin' ? [...NAV, ADMIN] : NAV;

  return (
    <div className="min-h-svh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="border-b bg-sidebar md:sticky md:top-0 md:flex md:h-svh md:flex-col md:border-r md:border-b-0">
        <div className="flex h-14 items-center justify-between px-4 md:h-16">
          <Logo />
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Đăng xuất"
            onClick={() => authClient.signOut()}
          >
            <LogOut />
          </Button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-1 md:flex-col md:overflow-visible md:pb-0">
          {items.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </nav>
        <div className="hidden space-y-2 border-t p-3 md:block">
          <p className="truncate px-1 text-muted-foreground text-xs" title={session.user.email}>
            {session.user.email}
          </p>
          <div className="flex items-center justify-between">
            <PushToggle />
            <Button variant="ghost" size="sm" onClick={() => authClient.signOut()}>
              <LogOut />
              Đăng xuất
            </Button>
          </div>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}
