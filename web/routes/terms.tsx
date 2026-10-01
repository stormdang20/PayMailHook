import { Link } from 'react-router';
import { PublicShell } from '@/components/public-shell';

export function TermsPage() {
  return (
    <PublicShell>
      <article lang="en" className="space-y-6 text-sm leading-relaxed">
        <title>Terms of Service | PayMailHook</title>
        <h1 className="font-semibold text-2xl">Terms of Service</h1>
        <p className="text-muted-foreground">Effective date: October 1, 2026</p>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">1. Service and scope</h2>
          <p>
            These terms apply to PayMailHook at paymailhook.stormdang20.workers.dev. By using this hosted service, you
            agree to these terms. PayMailHook processes supported bank notification emails into transaction records,
            payment webhooks, and optional integrations. It is not a bank or payment processor, does not hold or
            transfer funds, and is not affiliated with or endorsed by Google, CAKE, or Timo. The open-source software
            license and independently hosted installations are separate from these hosted-service terms.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">2. Accounts and authorized use</h2>
          <p>
            Connect only mailboxes and bank notification data that you own or are authorized to manage. Keep your
            account credentials, API keys, webhook secrets, and share links secure. You are responsible for your webhook
            destinations and integrations, and for any notices or permissions needed to process another person's
            transaction information. Do not use the service for fraud, unauthorized access, spam, or unlawful
            surveillance, or attempt to bypass access controls or disrupt other users.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">3. Transaction verification</h2>
          <p>
            Email notifications are not bank settlement records. Messages may be delayed, missing, or incompatible with
            the parser, and webhook delivery may be delayed, repeated, or unsuccessful. Verify webhook signatures,
            handle duplicate deliveries, and compare the order code, amount, and currency before fulfilling an order.
            Use your bank's records to resolve discrepancies. PayMailHook does not guarantee that an email or webhook
            proves final payment or that all transactions will be detected.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">4. Privacy and integrations</h2>
          <p>
            Our{' '}
            <Link className="text-primary underline" to="/privacy">
              Privacy Policy
            </Link>{' '}
            explains mailbox permissions, stored data, sharing, retention, and deletion. You control which mailbox
            connections, webhooks, API clients, and public share links you enable. Third-party services have their own
            terms and policies. Do not expose confidential transaction data through public links or untrusted
            integrations.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">5. Availability and limitations</h2>
          <p>
            The hosted service is currently provided without a service fee or an uptime commitment. Provider quotas,
            outages, revoked permissions, and changes to bank email formats can interrupt it. Features may change or
            become unavailable. To the extent permitted by applicable law, the service is provided as available without
            warranties of uninterrupted operation, accuracy, or fitness for a particular purpose. Nothing in these terms
            excludes rights or liabilities that cannot lawfully be excluded.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">6. Stopping use</h2>
          <p>
            You may stop using the service, delete mailbox configurations, and revoke Google access at any time.
            Deleting a configuration removes its associated transaction history, so save any records you need first.
            Contact the operator for account deletion. Access may be restricted to address abuse, security incidents,
            legal requirements, or violations of these terms.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">7. Changes and contact</h2>
          <p>
            Revised terms will be posted on this page with an updated effective date. Review them before continuing to
            use the service. For support, privacy requests, or questions about these terms, contact{' '}
            <a className="text-primary underline" href="mailto:dqst09@gmail.com">
              dqst09@gmail.com
            </a>
            .
          </p>
        </section>
      </article>
    </PublicShell>
  );
}
