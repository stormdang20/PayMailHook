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
import { AccountDialog } from '@/components/account-dialog';
import { Logo } from '@/components/logo';
import { PushToggle } from '@/components/push-toggle';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Item = { to: string; label: string; icon: LucideIcon };

const NAV: Item[] = [
  { to: '/dashboard', label: 'Kết nối', icon: Mailbox },
  { to: '/dashboard/transactions', label: 'Giao dịch', icon: ReceiptText },
  { to: '/dashboard/deliveries', label: 'Webhook', icon: Webhook },
  { to: '/dashboard/qr', label: 'Mã QR', icon: QrCode },
  { to: '/dashboard/api-keys', label: 'API key', icon: KeyRound },
  { to: '/dashboard/docs', label: 'Tài liệu', icon: BookOpen },
];
const ADMIN: Item = { to: '/dashboard/admin', label: 'Quản trị', icon: ShieldCheck };

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
/** Sign out and land on the product page rather than the sign-in form. */
const signOut = () => authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign('/') } });

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
          <div className="flex items-center gap-1 md:hidden">
            <AccountDialog user={session.user} />
            <PushToggle />
            <Button variant="ghost" size="icon" aria-label="Đăng xuất" title="Đăng xuất" onClick={signOut}>
              <LogOut />
            </Button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-1 md:flex-col md:overflow-visible md:pb-0">
          {items.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </nav>
        <div className="hidden space-y-2 border-t p-3 md:block">
          <div className="flex items-center gap-1">
            <AccountDialog user={session.user} />
            <PushToggle />
            <Button variant="ghost" size="icon" aria-label="Đăng xuất" title="Đăng xuất" onClick={signOut}>
              <LogOut />
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
