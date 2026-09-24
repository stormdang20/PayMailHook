import './app.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Toaster } from './components/ui/sonner';
import { AdminPage } from './routes/admin';
import { ApiKeysPage } from './routes/api-keys';
import { AuthPage } from './routes/auth-page';
import { ConfigsPage } from './routes/configs';
import { DeliveriesPage } from './routes/deliveries';
import { DocsPage } from './routes/docs';
import { Layout } from './routes/layout';
import { PrivacyPage } from './routes/privacy';
import { QrPage } from './routes/qr';
import { SharedListPage, SharedTransactionPage } from './routes/share';
import { TransactionsPage } from './routes/transactions';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  { path: '/sign-in', element: <AuthPage mode="sign-in" /> },
  { path: '/sign-up', element: <AuthPage mode="sign-up" /> },
  { path: '/guide', element: <Navigate to="/docs" replace /> },
  { path: '/privacy', Component: PrivacyPage },
  { path: '/share/t/:token', Component: SharedTransactionPage },
  { path: '/share/c/:token', Component: SharedListPage },
  {
    Component: Layout,
    children: [
      { index: true, Component: ConfigsPage },
      { path: 'transactions', Component: TransactionsPage },
      { path: 'deliveries', Component: DeliveriesPage },
      { path: 'qr', Component: QrPage },
      { path: 'admin', Component: AdminPage },
      { path: 'api-keys', Component: ApiKeysPage },
      { path: 'docs', Component: DocsPage },
    ],
  },
]);

const root = document.getElementById('root');
if (!root) throw new Error('#root missing in index.html');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
