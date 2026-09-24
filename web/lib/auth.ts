import { apiKeyClient } from '@better-auth/api-key/client';
import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ plugins: [adminClient(), apiKeyClient()] });

/** Unwraps better-auth client results so TanStack Query sees errors as thrown. */
export async function authCall<T>(call: Promise<{ data: T; error: { message?: string } | null }>) {
  const { data, error } = await call;
  if (error) throw new Error(error.message ?? 'Không thành công');
  return data;
}
