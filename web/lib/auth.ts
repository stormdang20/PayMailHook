import { apiKeyClient } from '@better-auth/api-key/client';
import { adminClient, usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ plugins: [adminClient(), apiKeyClient(), usernameClient()] });

/** Unwraps better-auth client results so TanStack Query sees errors as thrown. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function authCall<T>(call: Promise<{ data: T; error: { message?: string; code?: string } | null }>) {
  const { data, error } = await call;
  if (error) throw new AuthError(error.message ?? 'Không thành công', error.code);
  return data;
}

/** Sends the user to Google to grant read-only Gmail access, then back to connect the config. */
export const linkGmail = (configId: string) =>
  authClient.linkSocial({
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    callbackURL: `/?connect=${configId}`,
  });
