import { Link } from 'react-router';
import { PublicShell } from '@/components/public-shell';

export function PrivacyPage() {
  return (
    <PublicShell>
      <article lang="en" className="space-y-6 text-sm leading-relaxed">
        <title>Privacy Policy | PayMailHook</title>
        <h1 className="font-semibold text-2xl">Privacy Policy</h1>
        <p className="text-muted-foreground">Effective date: October 1, 2026</p>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">1. About this service</h2>
          <p>
            PayMailHook converts supported bank notification emails into transaction records and optional payment
            webhooks. This policy covers the hosted service at paymailhook.stormdang20.workers.dev. For privacy,
            support, or deletion requests, contact the service operator at{' '}
            <a className="text-primary underline" href="mailto:dqst09@gmail.com">
              dqst09@gmail.com
            </a>
            . Independently self-hosted installations are managed by their own operators.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">2. Google and email access</h2>
          <p>
            Google sign-in provides your account identifier, name, email address, and profile image when available.
            Connecting a Gmail mailbox separately requests the gmail.readonly permission. This permission can read your
            mailbox; it is not restricted by Google to bank emails. PayMailHook uses mailbox change identifiers and
            message metadata, including sender headers, to identify supported bank messages, then downloads those
            messages for verification and parsing. It does not use this permission to send, modify, or delete your Gmail
            messages.
          </p>
          <p>
            Supported notification senders currently include no-reply@cake.vn and support@timo.vn. Messages are checked
            against the configured recipient and bank DKIM signature before a transaction is accepted. Where email
            forwarding is enabled, the service receives the messages you forward and Gmail forwarding confirmation
            messages. Where IMAP is enabled, a supplied App Password allows retrieval of bank mail. These alternatives
            depend on the installation configuration.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">3. Information stored and its purpose</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Account and session information, including email, username, password hash for password accounts, linked
              Google account details, and OAuth access and refresh tokens, to authenticate you and maintain the mailbox
              connection.
            </li>
            <li>
              Mailbox addresses, bank selections, webhook URLs and secrets, order prefixes, forwarding confirmation
              details, and Gmail synchronization state, to operate your configured integrations.
            </li>
            <li>
              Parsed transaction information: message identifier, bank, amount, direction, time, description, matched
              order code, and any available balance, bank transaction identifier, or counterparty name, account, and
              bank, to display transactions and deliver the integrations you request.
            </li>
            <li>
              Webhook payloads, delivery results, and response excerpts for delivery troubleshooting. Successfully
              processed raw email is not retained in the application database. Some rejected messages are stored in
              encrypted form to diagnose verification or parsing failures.
            </li>
            <li>
              Session cookies and browser storage for sign-in, preferences, and connection flows. If push notifications
              are enabled and you opt in, browser subscription endpoints and keys are stored. Technical request and
              error logs may contain identifiers, IP addresses, and browser information for security and operations.
            </li>
          </ul>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">4. Sharing and service providers</h2>
          <p>
            The hosted service uses Cloudflare for application hosting and delivery infrastructure, Neon for its
            database, and Google for authentication, Gmail access, and mailbox change notifications. These providers
            process information needed to run the service. Processing locations depend on their infrastructure and the
            deployment configuration.
          </p>
          <p>
            Transaction data is sent to webhook destinations you configure and made available to integrations you
            authorize with API keys, including MCP clients. If you create a public share link, anyone with that link can
            view the shared amount, time, description, and order code without signing in. Descriptions may themselves
            contain personal information. You can revoke share links. Optional browser notifications travel through your
            browser's push provider as encrypted payloads. Recipients may retain copies that PayMailHook cannot delete.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">5. Google user data and Limited Use</h2>
          <p>
            PayMailHook uses Google user data only to provide the user-facing mailbox, transaction, and integration
            features described here. It does not sell Google user data or use it for advertising, credit scoring, or
            training general-purpose AI models. Human access to Google user data is limited to your explicit agreement
            for specific data, necessary security investigations, or legal obligations.
          </p>
          <p>
            PayMailHook's use and transfer of information received from Google APIs adheres to the{' '}
            <a
              className="text-primary underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
            >
              Google API Services User Data Policy
            </a>
            , including its Limited Use requirements.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">6. Retention and security</h2>
          <p>
            Transaction records remain until their mailbox configuration or account is deleted. Scheduled maintenance
            removes completed or failed webhook delivery records older than 30 days and stored rejected emails older
            than 7 days. Cleanup runs in batches, so removal may not occur at the exact cutoff. Configurations that have
            never ingested a valid email are also eligible for removal after 7 days. Account and linked OAuth
            credentials remain until the account or relevant linked credentials are removed. Infrastructure logs and
            backups follow the providers' configured retention, separately from these application cleanup schedules.
          </p>
          <p>
            The hosted website uses HTTPS. Passwords are hashed; stored IMAP App Passwords, webhook secrets, and
            rejected raw emails are encrypted with AES-GCM. Access controls restrict application data to its owner
            except for authorized sharing and operator administration. No service can guarantee absolute security.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">7. Your controls and deletion requests</h2>
          <p>
            Deleting a mailbox configuration in the dashboard deletes its transaction records, webhook history, and
            stored rejected emails from the application database. This does not delete messages in Gmail, remove the
            linked Google login, or automatically revoke Google's authorization. To stop Google access, remove
            PayMailHook in your{' '}
            <a className="text-primary underline" href="https://myaccount.google.com/connections">
              Google Account connections
            </a>
            . For other intake methods, disable Gmail forwarding or revoke the IMAP App Password as applicable. Revoking
            access alone does not erase data already stored by PayMailHook.
          </p>
          <p>
            Contact dqst09@gmail.com to request access, correction, or deletion of your account and associated stored
            data, including linked OAuth credentials. We may need to verify account ownership. Do not send passwords,
            OAuth tokens, or bank credentials in your request.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">8. Policy changes</h2>
          <p>
            Updates will be published here with a revised effective date. If Google data will be used for a new purpose,
            we will disclose that purpose and request consent before that use. See also our{' '}
            <Link className="text-primary underline" to="/terms">
              Terms of Service
            </Link>
            .
          </p>
        </section>
      </article>
    </PublicShell>
  );
}
