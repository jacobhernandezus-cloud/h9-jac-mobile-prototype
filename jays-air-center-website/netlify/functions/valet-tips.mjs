// Jay's Ramp Valet tips — real card payments via Stripe PaymentIntents.
//   GET  /api/valet-tips                       -> { configured, publishableKey }
//   POST /api/valet-tips {action:"intent",    requestId, amount}          -> { clientSecret, id }
//   POST /api/valet-tips {action:"confirmed", requestId, paymentIntentId} -> { request }
//
// Line service is an in-person physical service, so external payments are
// allowed on iOS (App Store Guideline 3.1.5(a)) — no IAP required.
// Talks to the Stripe REST API directly (no SDK dependency). Configure with:
//   netlify env:set STRIPE_SECRET_KEY sk_...
//   netlify env:set STRIPE_PUBLISHABLE_KEY pk_...
// Until those are set, GET reports configured:false and the app falls back
// to recorded-only tips billed through the tenant's FBO account.
import {
  sessionFromRequest, listRequests, updateRequest, corsHeaders, preflight,
} from './_lib/valet-store.mjs';

const SK = process.env.STRIPE_SECRET_KEY || '';
const PK = process.env.STRIPE_PUBLISHABLE_KEY || '';
const CONFIGURED = SK.startsWith('sk_') && PK.startsWith('pk_');
const MAX_TIP = 500; // dollars — sanity cap

async function stripe(method, path, params) {
  const opts = {
    method,
    headers: { authorization: `Bearer ${SK}` },
  };
  if (params) {
    opts.headers['content-type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params);
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error?.message || 'stripe-error');
    e.status = res.status;
    throw e;
  }
  return data;
}

export default async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const cors = corsHeaders(req);
  const json = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors },
  });
  try {
    if (req.method === 'GET') {
      return json(200, { configured: CONFIGURED, publishableKey: CONFIGURED ? PK : null });
    }
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

    const sess = sessionFromRequest(req);
    if (!sess) return json(401, { error: 'not signed in' });
    if (!CONFIGURED) return json(503, { error: 'payments-not-configured' });

    let p; try { p = await req.json(); } catch { return json(400, { error: 'invalid json' }); }

    // The tipped request must exist and belong to the caller.
    const all = await listRequests();
    const cur = all.find((r) => r.id === p.requestId);
    if (!cur) return json(404, { error: 'request not found' });
    if (cur.customerUid !== sess.uid) return json(403, { error: 'not your request' });

    if (p.action === 'intent') {
      const amount = Math.round(Number(p.amount));
      if (!Number.isFinite(amount) || amount < 1 || amount > MAX_TIP) {
        return json(400, { error: 'invalid amount' });
      }
      const pi = await stripe('POST', 'payment_intents', {
        amount: String(amount * 100), // cents
        currency: 'usd',
        'automatic_payment_methods[enabled]': 'true',
        description: `Lineman tip — ${cur.tail} (${cur.operatorName || 'crew'})`,
        'metadata[requestId]': cur.id,
        'metadata[customerUid]': sess.uid,
        'metadata[operatorName]': cur.operatorName || '',
      });
      return json(200, { clientSecret: pi.client_secret, id: pi.id });
    }

    if (p.action === 'confirmed') {
      // Never trust the client about money: re-fetch the PaymentIntent and
      // only record the tip if Stripe says it actually succeeded.
      if (!p.paymentIntentId) return json(400, { error: 'missing paymentIntentId' });
      const pi = await stripe('GET', `payment_intents/${encodeURIComponent(p.paymentIntentId)}`);
      if (pi.metadata?.requestId !== cur.id) return json(400, { error: 'intent/request mismatch' });
      if (pi.status !== 'succeeded') return json(409, { error: 'payment-not-succeeded', status: pi.status });
      const request = await updateRequest(cur.id, {
        tip: { amount: pi.amount / 100, paid: true, pi: pi.id },
      });
      return json(200, { request });
    }

    return json(400, { error: 'unknown action' });
  } catch (err) {
    console.error('valet-tips failed', err);
    return json(err.status === 402 ? 402 : 500, { error: err.message || 'server error' });
  }
};
