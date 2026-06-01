// Daily JAC Analytics Report — Netlify Scheduled Function.
//
// Fires once a day per the schedule in netlify.toml. Pulls all events from
// Firestore, renders the H9-branded HTML report, and emails it to
// daniel@h9partners.com via Resend.
//
// Also accepts manual HTTP triggers (GET/POST) for testing — visit
// https://jaysaircenter.com/.netlify/functions/daily-report?token=<secret>
//
// Required env vars:
//   FIREBASE_SERVICE_ACCOUNT_JSON  (already set, used by track.js too)
//   RESEND_API_KEY                 (re_... from https://resend.com)
//   DAILY_REPORT_TOKEN             (any string, shared secret for manual trigger auth)
//
// Optional env vars:
//   REPORT_TO        (recipient, default: daniel@h9partners.com)
//   REPORT_FROM      (sender, default: onboarding@resend.dev — change once h9partners.com domain is verified in Resend)

import { fetchEvents, computeMetrics, renderDashboardHtml } from './_lib/render-dashboard.mjs';

const DEFAULT_TO = 'daniel@h9partners.com';
const DEFAULT_FROM = 'JAC Analytics <onboarding@resend.dev>';

async function sendReport({ to, from, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${body}`);
  }
  return JSON.parse(body);
}

function buildSubject(m) {
  const date = new Date().toISOString().slice(0, 10);
  return `JAC Daily · ${date} · ${m.realEvents} events · ${m.uniqueVisitors} visitors`;
}

async function runReport() {
  const docs = await fetchEvents();
  const metrics = computeMetrics(docs);
  const html = renderDashboardHtml(metrics);
  const to = process.env.REPORT_TO || DEFAULT_TO;
  const from = process.env.REPORT_FROM || DEFAULT_FROM;
  const subject = buildSubject(metrics);
  const result = await sendReport({ to, from, subject, html });
  console.log('daily-report sent', { id: result.id, to, subject, events: metrics.totalEvents });
  return { ok: true, sent_to: to, subject, email_id: result.id, metrics_summary: {
    total_events: metrics.totalEvents,
    unique_visitors: metrics.uniqueVisitors,
    events_24h: metrics.events24h,
  } };
}

// ---------------------------------------------------------------------------
// Handler — handles both the scheduled trigger and HTTP requests.
// ---------------------------------------------------------------------------
// Netlify Scheduled Functions invoke the handler with no event.httpMethod
// (or with an internal scheduler payload). Manual HTTP triggers carry the
// usual { httpMethod, queryStringParameters, ... } shape.
export const handler = async (event) => {
  const isScheduled = !event?.httpMethod;

  // Manual HTTP triggers require the shared secret to prevent randos from
  // burning your Resend quota.
  if (!isScheduled) {
    const provided = event.queryStringParameters?.token;
    const expected = process.env.DAILY_REPORT_TOKEN;
    if (!expected) {
      return { statusCode: 500, body: JSON.stringify({ error: 'DAILY_REPORT_TOKEN not configured' }) };
    }
    if (provided !== expected) {
      return { statusCode: 401, body: JSON.stringify({ error: 'invalid token' }) };
    }
  }

  try {
    const result = await runReport();
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result, null, 2),
    };
  } catch (err) {
    console.error('daily-report failed', err);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: String(err.message || err) }),
    };
  }
};
