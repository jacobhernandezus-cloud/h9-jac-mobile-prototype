// Local-only test harness for netlify/functions/daily-report.mjs render logic.
// Runs the SAME computeMetrics + renderDashboardHtml that the production
// Netlify function calls, but writes the HTML to disk instead of emailing
// it. Useful for confirming render correctness without spending email quota.
//
// Requires FIREBASE_SERVICE_ACCOUNT_JSON env var (base64-encoded).
//
// Usage:
//   export FIREBASE_SERVICE_ACCOUNT_JSON=$(npx netlify env:get FIREBASE_SERVICE_ACCOUNT_JSON --context production --plain-text 2>/dev/null)
//   node scripts/test-daily-report-render.mjs
//   open docs/daily-report-preview.html

import { fetchEvents, computeMetrics, renderDashboardHtml } from '../netlify/functions/_lib/render-dashboard.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, '..', 'docs', 'daily-report-preview.html');

const docs = await fetchEvents();
const m = computeMetrics(docs);
const html = renderDashboardHtml(m);
writeFileSync(OUTPUT, html, 'utf-8');
console.log(`Wrote ${OUTPUT}`);
console.log(`  ${m.totalEvents} total events, ${m.realEvents} non-CLI, ${m.uniqueVisitors} unique visitors`);
console.log(`Open: open ${OUTPUT}`);
