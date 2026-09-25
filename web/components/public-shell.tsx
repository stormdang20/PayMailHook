import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/logo';
import { authClient } from '@/lib/auth';

/** Frame for pages anyone can open: docs, privacy, share links. */
export function PublicShell({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link to="/" aria-label="PayMailHook">
            <Logo />
          </Link>
          <nav className="ml-auto flex items-center gap-5 text-sm">
            <Link to="/privacy" className="text-muted-foreground hover:text-foreground">
              Quyền riêng tư
            </Link>
            <Link to="/docs" className="text-muted-foreground hover:text-foreground">
              Tài liệu
            </Link>
            <Link to={session ? '/dashboard' : '/sign-in'} className="font-medium text-primary">
              {session ? 'Mở dashboard' : 'Đăng nhập'}
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
    </div>
  );
}
