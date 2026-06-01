const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const ALLOWED_EVENTS = new Set([
  'page_view',
  'section_viewed',
  'cta_clicked',
  'form_started',
  'form_submitted',
  'form_completed',
  'external_click',
]);

const MAX_BODY_BYTES = 4 * 1024;

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not set');
    const sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    initializeApp({ credential: cert(sa) });
  }
  // Named database 'openavdb' (NOT default).
  return getFirestore('openavdb');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if ((event.body || '').length > MAX_BODY_BYTES) {
    return { statusCode: 413, body: JSON.stringify({ error: 'payload too large' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'invalid json' }) }; }

  if (!payload.event || !ALLOWED_EVENTS.has(payload.event)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid event name' }) };
  }
  if (!payload.visitor_id || !payload.session_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'missing visitor_id/session_id' }) };
  }

  // Netlify edge sets x-nf-geo (JSON-encoded). Older / local-dev paths may set x-country
  // directly. Either way we end with a 2-letter code or null — never undefined, which
  // Firestore rejects.
  let country = null;
  if (event.headers['x-country']) {
    country = String(event.headers['x-country']).slice(0, 8);
  } else if (event.headers['x-nf-geo']) {
    try {
      const geo = JSON.parse(event.headers['x-nf-geo']);
      if (geo && geo.country && geo.country.code) country = String(geo.country.code).slice(0, 8);
    } catch { /* malformed header, leave country null */ }
  }

  const doc = {
    event: payload.event,
    ts: FieldValue.serverTimestamp(),
    visitor_id: String(payload.visitor_id).slice(0, 64),
    session_id: String(payload.session_id).slice(0, 64),
    page_path: String(payload.page_path || '/').slice(0, 256),
    referrer: payload.referrer ? String(payload.referrer).slice(0, 512) : null,
    utm: payload.utm || null,
    device: payload.device || null,
    viewport: payload.viewport || null,
    country,
    ab_variant: payload.ab_variant ? String(payload.ab_variant).slice(0, 64) : null,
    properties: payload.properties || {},
  };

  try {
    await getDb().collection('jac_analytics_events').add(doc);
    return { statusCode: 202, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('track write failed', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'write failed' }) };
  }
};
