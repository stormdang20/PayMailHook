import { Navigate, NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Email' },
  { to: '/transactions', label: 'Giao dịch' },
  { to: '/deliveries', label: 'Webhook' },
  { to: '/qr', label: 'Mã QR' },
];

/** Signed-in shell: redirects to /sign-in without a session. */
export function Layout() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/sign-in" replace />;
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <span className="font-semibold">PayMailHook</span>
          <nav className="flex gap-4 text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{session.user.email}</span>
            <Button variant="outline" size="sm" onClick={() => authClient.signOut()}>
              Đăng xuất
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
