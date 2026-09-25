# PayMailHook email relay

Needed only to use the **forwarding** source on a self-hosted server. It lets Cloudflare Email Routing receive the mail for your inbound domain and posts each message to your server's `/api/inbound`, signed with a shared secret. No open port 25 or MX record on your server is required. (The hosted Worker handles mail itself and doesn't need this relay.)

1. Add a domain (or subdomain, e.g. `in.example.com`) to Cloudflare and enable **Email Routing** on it.
2. Deploy this Worker from this folder:
   ```bash
   npx wrangler deploy
   npx wrangler secret put PAYMAILHOOK_URL          # e.g. https://pay.example.com (must be reachable from the internet)
   npx wrangler secret put INBOUND_WEBHOOK_SECRET   # a random string, e.g. openssl rand -hex 32
   ```
3. In Email Routing, set the **catch-all** address to "Send to a Worker" → `paymailhook-email-relay`.
4. On the server, set `INBOUND_EMAIL_DOMAIN=in.example.com` and the same `INBOUND_WEBHOOK_SECRET`, then restart it. The dashboard now offers "Chuyển tiếp email".
