// Shared logic: pull events from Firestore, compute metrics, render the
// H9-branded daily-report HTML.
//
// Used by netlify/functions/daily-report.mjs (the scheduled job that emails
// the report). The Python script at scripts/build-dashboard.py renders the
// same metrics but is kept separate because it runs from your laptop using
// gcloud auth — this Node version uses the service-account env var that's
// already set on Netlify for the analytics ingest function.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const VARIANT_ORDER = ['join_waitlist', 'reserve_your_hangar', 'inquire_availability'];
const VARIANT_LABEL = {
  join_waitlist: 'Join Waitlist',
  reserve_your_hangar: 'Reserve Your Hangar',
  inquire_availability: 'Inquire About Availability',
};
const FUNNEL_STEPS = [
  ['page_view', 'Page view'],
  ['section_viewed', 'Section viewed'],
  ['cta_clicked', 'CTA clicked'],
  ['form_started', 'Form started'],
  ['form_completed', 'Form completed'],
];

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not set');
    const sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    initializeApp({ credential: cert(sa) });
  }
  return getFirestore('openavdb');
}

// ---------------------------------------------------------------------------
// Heuristic: filter out our own CLI smoke-test traffic.
// ---------------------------------------------------------------------------
function isCliTest(doc) {
  const props = doc.properties || {};
  if (
    'smoke_test' in props ||
    'verification_run' in props ||
    'final_check' in props ||
    'status_check' in props ||
    'from' in props
  ) return true;
  const vid = doc.visitor_id || '';
  return vid.startsWith('00000000-') || vid.includes('FINAL-CONFIRM') || vid.includes('PROD1');
}

// ---------------------------------------------------------------------------
// Compute metrics from raw event docs.
// ---------------------------------------------------------------------------
export function computeMetrics(docs) {
  const cli = docs.filter(isCliTest);
  const real = docs.filter(d => !isCliTest(d));

  // Funnel counts per variant
  const funnel = Object.fromEntries(VARIANT_ORDER.map(v => [v, {}]));
  for (const d of real) {
    const v = d.ab_variant;
    const ev = d.event;
    if (funnel[v] && ev) funnel[v][ev] = (funnel[v][ev] || 0) + 1;
  }

  // Sticky variant per unique visitor
  const vidToVariant = {};
  for (const d of real) {
    if (d.visitor_id && d.ab_variant && !(d.visitor_id in vidToVariant)) {
      vidToVariant[d.visitor_id] = d.ab_variant;
    }
  }
  const visitorsPerVariant = {};
  for (const v of Object.values(vidToVariant)) {
    visitorsPerVariant[v] = (visitorsPerVariant[v] || 0) + 1;
  }

  // Conversion rate per variant
  const convRate = {};
  for (const v of VARIANT_ORDER) {
    const clicks = funnel[v].cta_clicked || 0;
    const completes = funnel[v].form_completed || 0;
    convRate[v] = clicks ? (completes / clicks) * 100 : null;
  }

  // Section engagement
  const sections = {};
  for (const d of real) {
    if (d.event === 'section_viewed' && d.properties?.section) {
      sections[d.properties.section] = (sections[d.properties.section] || 0) + 1;
    }
  }

  // Hourly time series
  const byHour = {};
  for (const d of real) {
    if (d.ts) {
      const h = d.ts.slice(0, 13).replace('T', ' ');
      byHour[h] = (byHour[h] || 0) + 1;
    }
  }

  // Referrers / devices / countries
  const referrers = {};
  const devices = {};
  const countries = {};
  for (const d of real) {
    if (d.referrer) referrers[d.referrer] = (referrers[d.referrer] || 0) + 1;
    if (d.device) devices[d.device] = (devices[d.device] || 0) + 1;
    if (d.country) countries[d.country] = (countries[d.country] || 0) + 1;
  }

  // Recent activity (last 20, newest first)
  const recent = [...real].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 20);

  // 24h count
  const now = Date.now();
  const events24h = real.filter(d => {
    if (!d.ts) return false;
    return new Date(d.ts).getTime() > now - 86400_000;
  }).length;

  return {
    totalEvents: docs.length,
    cliEvents: cli.length,
    realEvents: real.length,
    uniqueVisitors: Object.keys(vidToVariant).length,
    events24h,
    funnel,
    visitorsPerVariant,
    convRate,
    sections,
    byHour,
    referrers,
    devices,
    countries,
    recent,
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
  };
}

// ---------------------------------------------------------------------------
// Firestore fetch — pulls all events, flattens typed-value shapes.
// ---------------------------------------------------------------------------
export async function fetchEvents() {
  const snap = await getDb().collection('jac_analytics_events').get();
  return snap.docs.map(d => {
    const data = d.data();
    // Normalize Firestore Timestamp -> ISO string for downstream code
    if (data.ts && typeof data.ts.toDate === 'function') {
      data.ts = data.ts.toDate().toISOString();
    }
    return data;
  });
}

// ---------------------------------------------------------------------------
// HTML rendering helpers
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function barChart(rows, maxValue) {
  if (!rows.length) return '<p class="empty">No data yet.</p>';
  const maxv = (maxValue ?? Math.max(...rows.map(r => r[1]))) || 1;
  const items = rows.map(([label, n]) => {
    const pct = maxv ? (n / maxv) * 100 : 0;
    return `
      <div class="bar-row">
        <div class="bar-label">${esc(label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width: ${pct.toFixed(1)}%;"></div></div>
        <div class="bar-value">${n}</div>
      </div>`;
  }).join('');
  return `<div class="bar-chart">${items}</div>`;
}

function funnelChart(funnel, visitorsPerVariant) {
  const cols = VARIANT_ORDER.map(v => {
    const c = funnel[v] || {};
    const maxForVariant = c.page_view || 1;
    const visitors = visitorsPerVariant[v] || 0;
    const stepsHtml = FUNNEL_STEPS.map(([key, label]) => {
      const n = c[key] || 0;
      const pct = maxForVariant ? (n / maxForVariant) * 100 : 0;
      return `
        <div class="funnel-step">
          <div class="funnel-step-label">${esc(label)}</div>
          <div class="funnel-step-value">${n}</div>
          <div class="funnel-step-bar"><div class="funnel-step-fill" style="width: ${pct.toFixed(0)}%;"></div></div>
        </div>`;
    }).join('');
    return `
      <div class="funnel-col">
        <div class="funnel-col-head">
          <div class="funnel-col-title">${esc(VARIANT_LABEL[v])}</div>
          <div class="funnel-col-sub">${visitors} ${visitors === 1 ? 'visitor' : 'visitors'}</div>
        </div>
        <div class="funnel-steps">${stepsHtml}</div>
      </div>`;
  }).join('');
  return `<div class="funnel">${cols}</div>`;
}

function conversionChart(convRate, funnel) {
  const rows = VARIANT_ORDER.map(v => {
    const rate = convRate[v];
    const clicks = funnel[v]?.cta_clicked || 0;
    const completes = funnel[v]?.form_completed || 0;
    const display = rate === null
      ? '<span class="conv-na">no clicks yet</span>'
      : `${rate.toFixed(1)}%`;
    const pct = rate === null ? 0 : Math.min(rate, 100);
    return `
      <div class="conv-row">
        <div class="conv-label">${esc(VARIANT_LABEL[v])}</div>
        <div class="conv-track"><div class="conv-fill" style="width: ${pct.toFixed(1)}%;"></div></div>
        <div class="conv-value">${display}</div>
        <div class="conv-detail">${completes} / ${clicks}</div>
      </div>`;
  }).join('');
  return `<div class="conv-chart">${rows}</div>`;
}

function recentTable(recent) {
  if (!recent.length) return '<p class="empty">No events yet.</p>';
  const rowsHtml = recent.map(r => {
    const ts = r.ts || '';
    const dateShort = ts.slice(0, 10);
    const timeShort = ts.slice(11, 19);
    const sectionExtra = r.properties?.section ? ` · ${esc(r.properties.section)}` : '';
    const vidShort = (r.visitor_id || '').slice(0, 8);
    return `
      <tr>
        <td class="t-time">${esc(dateShort)}<br><span class="t-sub">${esc(timeShort)}</span></td>
        <td class="t-event">${esc(r.event || '?')}${sectionExtra}</td>
        <td class="t-variant">${esc(VARIANT_LABEL[r.ab_variant] || r.ab_variant || '?')}</td>
        <td class="t-page">${esc(r.page_path || '/')}</td>
        <td class="t-meta">${esc(r.device || '?')} · ${esc(r.country || '?')}</td>
        <td class="t-vid">${esc(vidShort)}…</td>
      </tr>`;
  }).join('');
  return `
    <table class="activity">
      <thead><tr><th>When (UTC)</th><th>Event</th><th>Variant</th><th>Page</th><th>Device · Country</th><th>Visitor</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

function kpiCard(label, value, sub) {
  return `
    <div class="kpi">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(String(value))}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
    </div>`;
}

const STYLE = `
:root {
  --orange:#FF8C00; --orange-glow:rgba(255,140,0,0.35); --orange-soft:rgba(255,140,0,0.10);
  --navy:#142338; --cream:#FAF8F4; --pearl:#F0F0F0; --text:#1E1E1E; --muted:#5a6573;
  --rule:rgba(20,35,60,0.08); --rule-strong:rgba(20,35,60,0.16); --rust:#b3613f;
}
* { box-sizing: border-box; }
body { margin:0; padding:0; background:var(--cream); color:var(--text); font-family:'Inter',Arial,sans-serif; font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased; }
.doc { max-width:1100px; margin:0 auto; padding:40px 32px 56px; }
header.top { display:flex; align-items:center; justify-content:space-between; margin-bottom:32px; }
.brand { display:flex; align-items:center; gap:14px; }
.logo-mark { width:36px; height:36px; border-radius:0.55rem; background:var(--navy); border:1.5px solid var(--orange); display:flex; align-items:center; justify-content:center; color:var(--orange); font-family:'Big Shoulders Display','Arial Narrow',sans-serif; font-weight:800; font-size:15px; }
.wordmark { font-family:'Geologica','Inter',sans-serif; font-weight:700; font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:var(--navy); }
.gen-stamp { font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.08em; color:var(--muted); }
.eyebrow { display:flex; align-items:center; gap:10px; font-size:11px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px; }
.pulse-dot { width:8px; height:8px; background:var(--orange); border-radius:50%; box-shadow:0 0 12px var(--orange-glow); }
h1 { font-family:'Big Shoulders Display','Arial Narrow',sans-serif; font-weight:800; font-size:42px; letter-spacing:0.01em; line-height:1.05; text-transform:uppercase; color:var(--navy); margin:0 0 8px; }
.subtitle { color:var(--muted); margin:0 0 36px; max-width:680px; font-size:16px; }
h2 { font-family:'Big Shoulders Display','Arial Narrow',sans-serif; font-weight:800; font-size:20px; letter-spacing:0.02em; line-height:1.1; text-transform:uppercase; color:var(--navy); margin:44px 0 6px; }
.rule { width:56px; height:3px; background:var(--orange); box-shadow:0 0 12px var(--orange-glow); margin:0 0 20px; border-radius:1.5px; }
.kpis { display:grid; grid-template-columns:repeat(4, 1fr); gap:16px; margin-bottom:8px; }
.kpi { background:#fff; border:1px solid var(--rule); border-radius:10px; padding:18px 20px; }
.kpi-label { font-size:10px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase; color:var(--muted); margin-bottom:6px; }
.kpi-value { font-family:'Big Shoulders Display','Arial Narrow',sans-serif; font-weight:800; font-size:32px; color:var(--navy); line-height:1.05; }
.kpi-sub { font-size:11px; color:var(--muted); margin-top:6px; }
.caveat { background:var(--orange-soft); border-left:3px solid var(--orange); border-radius:4px; padding:14px 18px; margin:18px 0 0; font-size:14px; color:var(--text); }
.caveat strong { color:var(--navy); }
.bar-chart { display:flex; flex-direction:column; gap:8px; }
.bar-row { display:grid; grid-template-columns:200px 1fr 60px; align-items:center; gap:12px; font-size:14px; }
.bar-label { color:var(--text); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bar-track { background:var(--pearl); border-radius:4px; height:18px; overflow:hidden; }
.bar-fill { background:linear-gradient(90deg, var(--orange) 0%, #ffaa3d 100%); height:100%; border-radius:4px; }
.bar-value { font-family:'JetBrains Mono',monospace; font-weight:500; color:var(--navy); text-align:right; }
.funnel { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
.funnel-col { background:#fff; border:1px solid var(--rule); border-radius:10px; padding:18px 20px; }
.funnel-col-head { border-bottom:1px solid var(--rule); padding-bottom:12px; margin-bottom:14px; }
.funnel-col-title { font-weight:700; color:var(--navy); font-size:15px; }
.funnel-col-sub { font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin-top:4px; font-family:'JetBrains Mono',monospace; }
.funnel-steps { display:flex; flex-direction:column; gap:8px; }
.funnel-step { display:grid; grid-template-columns:1fr auto; column-gap:8px; row-gap:2px; align-items:center; font-size:13px; }
.funnel-step-label { grid-column:1; grid-row:1; color:var(--muted); }
.funnel-step-value { grid-column:2; grid-row:1; font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--navy); text-align:right; font-weight:500; }
.funnel-step-bar { grid-column:1 / -1; grid-row:2; background:var(--pearl); border-radius:3px; height:8px; overflow:hidden; }
.funnel-step-fill { background:var(--navy); height:100%; border-radius:3px; }
.conv-chart { display:flex; flex-direction:column; gap:10px; }
.conv-row { display:grid; grid-template-columns:220px 1fr 80px 80px; align-items:center; gap:12px; font-size:14px; padding:6px 0; }
.conv-label { font-weight:600; color:var(--navy); }
.conv-track { background:var(--pearl); border-radius:4px; height:24px; overflow:hidden; }
.conv-fill { background:linear-gradient(90deg, var(--orange) 0%, var(--rust) 100%); height:100%; border-radius:4px; }
.conv-value { font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--navy); text-align:right; }
.conv-detail { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--muted); text-align:right; }
.conv-na { color:var(--muted); font-style:italic; font-size:13px; font-family:'Inter',sans-serif; font-weight:400; letter-spacing:0; }
.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:32px; }
.activity { width:100%; border-collapse:collapse; font-size:13px; }
.activity th { text-align:left; font-weight:600; font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:var(--muted); padding:8px 12px 8px 0; border-bottom:1px solid var(--rule-strong); }
.activity td { padding:10px 12px 10px 0; border-bottom:1px solid var(--rule); vertical-align:top; }
.t-time { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--navy); white-space:nowrap; }
.t-time .t-sub { color:var(--muted); font-size:11px; }
.t-event { font-weight:500; color:var(--navy); }
.t-variant { color:var(--muted); font-size:12px; }
.t-page { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--text); }
.t-meta { color:var(--muted); font-size:12px; }
.t-vid { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--muted); }
.empty { color:var(--muted); font-style:italic; padding:20px 0; }
footer { margin-top:56px; padding-top:24px; border-top:1px solid var(--rule); display:flex; justify-content:space-between; font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); }
@media (max-width: 900px) {
  .kpis { grid-template-columns:repeat(2, 1fr); }
  .funnel { grid-template-columns:1fr; }
  .grid-2 { grid-template-columns:1fr; }
  .conv-row { grid-template-columns:140px 1fr 60px 60px; }
  .bar-row { grid-template-columns:120px 1fr 50px; }
}
`;

// ---------------------------------------------------------------------------
// Render the full HTML report.
// ---------------------------------------------------------------------------
export function renderDashboardHtml(m) {
  const kpis = [
    kpiCard('Browser events', m.realEvents, `${m.cliEvents} excluded CLI tests`),
    kpiCard('Unique visitors', m.uniqueVisitors, ''),
    kpiCard('Events · last 24h', m.events24h, ''),
    kpiCard('Total stored', m.totalEvents, 'Persists in Firestore'),
  ].join('');

  const varRows = VARIANT_ORDER.map(v => [VARIANT_LABEL[v], m.visitorsPerVariant[v] || 0]);
  const sectionRows = Object.entries(m.sections).sort((a, b) => b[1] - a[1]);
  const hourRows = Object.entries(m.byHour).sort();
  const refRows = Object.entries(m.referrers).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const deviceRows = Object.entries(m.devices).sort((a, b) => b[1] - a[1]);
  const countryRows = Object.entries(m.countries).sort((a, b) => b[1] - a[1]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Jay's Air Center · Daily Analytics</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800&family=Geologica:wght@700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<div class="doc">
  <header class="top">
    <div class="brand">
      <div class="logo-mark">H9</div>
      <div class="wordmark">H9 Partners</div>
    </div>
    <div class="gen-stamp">Daily report · ${esc(m.generatedAt)}</div>
  </header>

  <div class="eyebrow"><div class="pulse-dot"></div>Jay's Air Center · CTA Experiment</div>
  <h1>Daily Performance</h1>
  <p class="subtitle">Automated end-of-day snapshot of the 3-variant CTA A/B test on jaysaircenter.com. Delivered by the daily-report Netlify function.</p>

  <div class="kpis">${kpis}</div>

  <div class="caveat">
    <strong>Reading note.</strong> CLI smoke tests (with tagged synthetic visitor IDs) are excluded automatically. Conversion rates remain noisy until visitor counts pass roughly 100 per variant.
  </div>

  <h2>Conversion Rate by Variant</h2><div class="rule"></div>
  <p class="subtitle" style="margin-bottom:18px;">form_completed / cta_clicked — the experiment's primary metric.</p>
  ${conversionChart(m.convRate, m.funnel)}

  <h2>Funnel by Variant</h2><div class="rule"></div>
  <p class="subtitle" style="margin-bottom:18px;">Step-by-step drop-off, scaled within each column (each variant's page_view = 100%).</p>
  ${funnelChart(m.funnel, m.visitorsPerVariant)}

  <h2>Variant Assignment Distribution</h2><div class="rule"></div>
  <p class="subtitle" style="margin-bottom:18px;">Unique visitors per arm. Should approach 33/33/33 in steady state.</p>
  ${barChart(varRows)}

  <div class="grid-2">
    <div>
      <h2>Section Engagement</h2><div class="rule"></div>
      ${barChart(sectionRows)}
    </div>
    <div>
      <h2>Traffic by Hour (UTC)</h2><div class="rule"></div>
      ${barChart(hourRows)}
    </div>
  </div>

  <div class="grid-2">
    <div>
      <h2>Top Referrers</h2><div class="rule"></div>
      ${refRows.length ? barChart(refRows) : '<p class="empty">No referrers captured yet (all visits direct).</p>'}
    </div>
    <div>
      <h2>Device &amp; Country</h2><div class="rule"></div>
      <div style="display:flex; flex-direction:column; gap:18px;">
        <div>${barChart(deviceRows)}</div>
        <div>${barChart(countryRows)}</div>
      </div>
    </div>
  </div>

  <h2>Recent Activity</h2><div class="rule"></div>
  ${recentTable(m.recent)}

  <footer>
    <span>Confidential · H9 Partners</span>
    <span>Live data: jaysaircenter.com/api/daily-report</span>
  </footer>
</div>
</body>
</html>`;
}
