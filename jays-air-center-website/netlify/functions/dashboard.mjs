// Live JAC Analytics Dashboard — password-protected via HTTP Basic Auth.
//
// Routed at /dashboard via netlify.toml. Each request regenerates fresh HTML
// from Firestore — no stale snapshots, no committed artifact. Designed for
// daily viewing by Daniel + occasional sharing with George Sumner / partners.
//
// Required env vars:
//   FIREBASE_SERVICE_ACCOUNT_JSON  (already set, used by track.js + daily-report.mjs)
//   DASHBOARD_BASIC_AUTH           (format: "user:password")
//
// Browser prompts for credentials the first time, then caches them per host
// for the rest of the browser session. Same UX as any other basic-auth page.

import { fetchEvents, computeMetrics, renderDashboardHtml } from './_lib/render-dashboard.mjs';

const REALM = 'Jay\'s Air Center Analytics';

function unauthorized() {
  return {
    statusCode: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
    },
    body: 'Authentication required.',
  };
}

// Constant-time string comparison to dodge timing-based credential probing.
// Lengths must match for true equality, so we also check length explicitly.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const handler = async (event) => {
  const stored = process.env.DASHBOARD_BASIC_AUTH;
  if (!stored || !stored.includes(':')) {
    return {
      statusCode: 500,
      body: 'DASHBOARD_BASIC_AUTH not configured (expected "user:password" format)',
    };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Basic ')) {
    return unauthorized();
  }

  let provided;
  try {
    provided = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return unauthorized();
  }

  if (!safeEqual(provided, stored)) {
    return unauthorized();
  }

  try {
    const docs = await fetchEvents();
    const metrics = computeMetrics(docs);
    const html = renderDashboardHtml(metrics);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // 5min CDN cache: fresh enough for a daily-read dashboard, cuts Firestore
        // costs if you refresh repeatedly. private = don't cache at any shared
        // proxy beyond the immediate user's browser/the Netlify edge.
        'Cache-Control': 'private, max-age=300',
        // Belt-and-suspenders: even if someone shares the URL publicly, search
        // engines (and well-behaved scrapers) will skip it.
        'X-Robots-Tag': 'noindex, nofollow',
      },
      body: html,
    };
  } catch (err) {
    console.error('dashboard render failed', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: `Dashboard render failed: ${err.message || err}`,
    };
  }
};
