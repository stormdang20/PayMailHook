// PayMailHook email relay for self-hosted servers (pattern from mailflare's cloudflare-email-relay):
// Cloudflare Email Routing keeps the MX; every message routed here is posted to the server's
// /api/inbound, signed with INBOUND_WEBHOOK_SECRET so the server knows it came from this relay.
type Env = { PAYMAILHOOK_URL: string; INBOUND_WEBHOOK_SECRET: string };

async function sign(secret: string, to: string, raw: Uint8Array) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const prefix = new TextEncoder().encode(`${to}\n`);
  const data = new Uint8Array(prefix.length + raw.length);
  data.set(prefix);
  data.set(raw, prefix.length);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, data))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default {
  async email(message, env) {
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const res = await fetch(`${env.PAYMAILHOOK_URL.replace(/\/$/, '')}/api/inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'message/rfc822',
        'x-inbound-to': message.to,
        'x-inbound-signature': await sign(env.INBOUND_WEBHOOK_SECRET, message.to, raw),
      },
      body: raw,
    }).catch((e: unknown) => e);
    if (res instanceof Response && res.status === 404) return message.setReject('Unknown address');
    if (!(res instanceof Response) || !res.ok) {
      console.error('PayMailHook relay failed', res instanceof Response ? res.status : res);
      // Worded as temporary so Gmail retries the forward later instead of giving up.
      message.setReject('PayMailHook is temporarily unavailable, please retry later');
    }
  },
} satisfies ExportedHandler<Env>;
