import { apiKeyClient } from '@better-auth/api-key/client';
import { adminClient, usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { BankCode } from '@/components/bank-picker';

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
    callbackURL: `/dashboard?connect=${configId}`,
    errorCallbackURL: '/dashboard?gmailError=reconnect',
    additionalParams: { prompt: 'consent select_account' },
  });

export type GmailDraft = { banks: BankCode[]; webhookUrl: string | null };

export async function addGmail(draft: GmailDraft) {
  const flow = crypto.randomUUID();
  sessionStorage.setItem(`gmail:${flow}`, JSON.stringify(draft));
  try {
    await authCall(
      authClient.linkSocial({
        provider: 'google',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        additionalParams: { prompt: 'consent select_account' },
        additionalData: { gmailConnect: flow },
        callbackURL: `/dashboard?gmail=${flow}`,
        errorCallbackURL: `/dashboard?gmailError=${flow}`,
      }),
    );
  } catch (error) {
    sessionStorage.removeItem(`gmail:${flow}`);
    throw error;
  }
}
