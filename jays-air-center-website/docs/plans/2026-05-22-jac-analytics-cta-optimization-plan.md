# Jay's Air Center Analytics + CTA A/B Test — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instrument the Jay's Air Center site with privacy-respecting, self-hosted analytics (Netlify Function → Firestore) and ship a 3-variant A/B test on the primary CTA from day one.

**Architecture:** Browser fires events to a Netlify Function (`/api/track`) which authenticates server-side with `firebase-admin` and writes to the `jac_analytics_events` collection in the existing `openavdb-prod` Firebase project's named database `openavdb`. Identity is cookieless (UUIDs in localStorage/sessionStorage). A/B variant is assigned deterministically by hashing `visitor_id` and stays sticky in localStorage so a returning visitor always sees the same CTA.

**Tech Stack:** Static HTML + Tailwind (existing), vanilla JS client library, Netlify Functions (Node.js 20), `firebase-admin` v12+, `uuid` v9+, Jest + jest-environment-jsdom (existing).

**Design doc:** [docs/plans/2026-05-22-jac-analytics-cta-optimization-design.md](2026-05-22-jac-analytics-cta-optimization-design.md)

**Working dir for all paths in this plan:** `apps/jays-air-center-website/`

---

## Pre-flight: confirm assumptions before starting

Before Task 1, run these checks. If any fail, stop and resolve before writing code.

```bash
# 1. Firebase project exists and named DB is reachable
gcloud auth list                          # expect authed account
firebase projects:list | grep openavdb-prod   # expect a row

# 2. Existing test suite passes (don't break the baseline)
cd apps/jays-air-center-website && npm test

# 3. Site builds locally
cd apps/jays-air-center-website && npm run build && ls -la css/output.css

# 4. Confirm netlify CLI is available (used for env var setup later)
npx netlify --version
```

Expected: all four succeed. If `npm test` fails on a pre-existing test, capture the failure and ask the user how to proceed — do not paper over it.

---

## Task 1: Add runtime dependencies

**Why:** `firebase-admin` is the only way to write to Firestore from a Netlify Function with server-side credentials. `uuid` is the standard for RFC 4122 v4 IDs (avoid hand-rolling — historical bug source).

**Files:**
- Modify: `package.json`

**Step 1.1: Add deps**

```bash
cd apps/jays-air-center-website
npm install --save firebase-admin@^12 uuid@^9
```

**Step 1.2: Verify**

```bash
node -e "console.log(require('firebase-admin/package.json').version)"
node -e "console.log(require('uuid/package.json').version)"
```

Expected: prints `12.x.x` and `9.x.x` (or higher).

**Step 1.3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(jays-air-center-website): add firebase-admin + uuid for analytics ingest"
```

---

## Task 2: Set up Firebase service account env var (one-time setup, documented)

**Why:** The Netlify Function needs Firestore write credentials. We store them base64-encoded so multiline JSON survives Netlify's env-var UI.

**Files:**
- Create: `docs/setup/firebase-service-account.md` (runbook only — no code)

**Step 2.1: Generate service account in Firebase Console**

Manual step (Daniel):
1. Visit https://console.firebase.google.com/project/openavdb-prod/settings/serviceaccounts/adminsdk
2. Click "Generate new private key"
3. Save the JSON file locally as `~/Downloads/openavdb-prod-sa.json` (do NOT commit)

**Step 2.2: Encode and set Netlify env var**

```bash
# Base64-encode the JSON (one line, no newlines)
SA_B64=$(base64 -i ~/Downloads/openavdb-prod-sa.json)

# Set on the Netlify site (replace SITE_ID with Jay's Air Center's Netlify site ID)
npx netlify env:set FIREBASE_SERVICE_ACCOUNT_JSON "$SA_B64" --context production

# Verify it was set (won't print the value)
npx netlify env:list
```

**Step 2.3: Write the runbook**

Create `docs/setup/firebase-service-account.md` documenting the two steps above + rotation procedure. This is what Daniel will read in 6 months when he forgets how he set this up.

**Step 2.4: Securely delete the local SA file**

```bash
rm ~/Downloads/openavdb-prod-sa.json
```

**Step 2.5: Commit**

```bash
git add docs/setup/firebase-service-account.md
git commit -m "docs(jays-air-center-website): runbook for Firebase service-account env var"
```

---

## Task 3: Write the Netlify Function — tests first

**Why TDD here:** This is the security boundary. Schema validation bugs become spam ingest. Worth the test discipline.

**Files:**
- Create: `tests/functions/track.test.js`
- Create: `netlify/functions/track.js`

**Step 3.1: Write failing test for schema validation**

`tests/functions/track.test.js`:

```js
/**
 * @jest-environment node
 */
const { handler } = require('../../netlify/functions/track');

// Mock firebase-admin BEFORE requiring track.js
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  cert: jest.fn(),
}));
jest.mock('firebase-admin/firestore', () => {
  const add = jest.fn().mockResolvedValue({ id: 'doc-id' });
  return {
    getFirestore: jest.fn(() => ({
      collection: jest.fn(() => ({ add })),
    })),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
  };
});

process.env.FIREBASE_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify({
  project_id: 'openavdb-prod',
  client_email: 'fake@example.com',
  private_key: 'fake',
})).toString('base64');

function makeEvent(overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-country': 'US' },
    body: JSON.stringify({
      event: 'page_view',
      visitor_id: '00000000-0000-4000-8000-000000000001',
      session_id: '00000000-0000-4000-8000-000000000002',
      page_path: '/',
      device: 'desktop',
      viewport: { w: 1440, h: 900 },
      ab_variant: 'join_waitlist',
      properties: {},
      ...overrides,
    }),
  };
}

test('rejects non-POST', async () => {
  const res = await handler({ httpMethod: 'GET' });
  expect(res.statusCode).toBe(405);
});

test('rejects missing event name', async () => {
  const res = await handler(makeEvent({ event: undefined }));
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body).error).toMatch(/event/i);
});

test('rejects unknown event name', async () => {
  const res = await handler(makeEvent({ event: 'rm_rf' }));
  expect(res.statusCode).toBe(400);
});

test('accepts valid page_view and writes to Firestore', async () => {
  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(202);
});

test('rejects oversized payload (>4KB)', async () => {
  const huge = 'x'.repeat(5000);
  const res = await handler(makeEvent({ properties: { junk: huge } }));
  expect(res.statusCode).toBe(413);
});
```

**Step 3.2: Run test, expect FAIL**

```bash
cd apps/jays-air-center-website
npx jest tests/functions/track.test.js
```

Expected: all tests fail with "Cannot find module '../../netlify/functions/track'".

**Step 3.3: Implement minimal track.js**

`netlify/functions/track.js`:

```js
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
```

**Step 3.4: Run test, expect PASS**

```bash
npx jest tests/functions/track.test.js
```

Expected: all 5 tests pass.

**Step 3.5: Commit**

```bash
git add tests/functions/track.test.js netlify/functions/track.js
git commit -m "feat(jays-air-center-website): Netlify Function for analytics ingest"
```

---

## Task 4: Identity + variant module (TDD)

**Why TDD here:** Deterministic hashing and UUID stability are easy to break invisibly. A returning visitor seeing a different A/B variant would silently contaminate the experiment.

**Files:**
- Create: `tests/js/identity.test.js`
- Create: `js/identity.js`

**Step 4.1: Write failing tests**

`tests/js/identity.test.js`:

```js
/**
 * @jest-environment jsdom
 */
const { getOrCreateVisitorId, getOrCreateSessionId, getVariant, _hash } = require('../../js/identity');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const VARIANTS = ['a', 'b', 'c'];

test('visitor id is stable across calls', () => {
  const a = getOrCreateVisitorId();
  const b = getOrCreateVisitorId();
  expect(a).toBe(b);
  expect(a).toMatch(/^[0-9a-f-]{36}$/);
});

test('visitor id survives sessionStorage clear', () => {
  const a = getOrCreateVisitorId();
  sessionStorage.clear();
  expect(getOrCreateVisitorId()).toBe(a);
});

test('session id is stable within a session, new across', () => {
  const a = getOrCreateSessionId();
  expect(getOrCreateSessionId()).toBe(a);
  sessionStorage.clear();
  expect(getOrCreateSessionId()).not.toBe(a);
});

test('variant assignment is deterministic for a given visitor', () => {
  localStorage.setItem('jac_vid', 'fixed-visitor-id-1');
  const v1 = getVariant(VARIANTS);
  localStorage.removeItem('jac_ab');  // clear sticky, recompute
  const v2 = getVariant(VARIANTS);
  expect(v1).toBe(v2);
});

test('variant assignment is sticky in localStorage', () => {
  localStorage.setItem('jac_vid', 'visitor-x');
  const first = getVariant(VARIANTS);
  expect(localStorage.getItem('jac_ab')).toBe(first);
  // Even if VARIANTS list changes, sticky value wins if still valid
  const second = getVariant(VARIANTS);
  expect(second).toBe(first);
});

test('variant assignment is roughly uniform across many visitors', () => {
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 3000; i++) {
    localStorage.clear();
    localStorage.setItem('jac_vid', `visitor-${i}`);
    counts[getVariant(VARIANTS)]++;
  }
  // Each bucket between 28% and 38% (allowing for hash distribution variance)
  for (const k of VARIANTS) {
    expect(counts[k]).toBeGreaterThan(840);
    expect(counts[k]).toBeLessThan(1140);
  }
});

test('hash is deterministic', () => {
  expect(_hash('hello')).toBe(_hash('hello'));
  expect(_hash('hello')).not.toBe(_hash('world'));
});
```

**Step 4.2: Run test, expect FAIL**

```bash
npx jest tests/js/identity.test.js
```

Expected: module not found.

**Step 4.3: Implement identity.js**

`js/identity.js`:

```js
// Tiny deterministic 32-bit hash (FNV-1a). Used for A/B bucket assignment.
// We do NOT use crypto.subtle because it's async and we want sync variant
// resolution before page paint (no FOUC of the wrong CTA text).
function _hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function _uuidv4() {
  // Native if available, else RFC4122 v4 fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for very old browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getOrCreateVisitorId() {
  let id = localStorage.getItem('jac_vid');
  if (!id) {
    id = _uuidv4();
    localStorage.setItem('jac_vid', id);
  }
  return id;
}

function getOrCreateSessionId() {
  let id = sessionStorage.getItem('jac_sid');
  if (!id) {
    id = _uuidv4();
    sessionStorage.setItem('jac_sid', id);
  }
  return id;
}

function getVariant(variantIds) {
  const sticky = localStorage.getItem('jac_ab');
  if (sticky && variantIds.includes(sticky)) return sticky;
  const vid = getOrCreateVisitorId();
  const chosen = variantIds[_hash(vid) % variantIds.length];
  localStorage.setItem('jac_ab', chosen);
  return chosen;
}

// CommonJS export for jest; browser uses global window.JacIdentity (set in analytics.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getOrCreateVisitorId, getOrCreateSessionId, getVariant, _hash };
}
```

**Step 4.4: Run test, expect PASS**

```bash
npx jest tests/js/identity.test.js
```

If the uniformity test fails (last test), the hash distribution is off. Try changing the FNV multiplier or seed — but only after confirming all OTHER tests pass. The uniformity test has built-in tolerance (28%–38%), so a real failure means the hash is genuinely uneven.

**Step 4.5: Commit**

```bash
git add tests/js/identity.test.js js/identity.js
git commit -m "feat(jays-air-center-website): visitor/session identity + sticky A/B assignment"
```

---

## Task 5: Event sender + analytics.js (TDD for sender, manual for DOM bindings)

**Files:**
- Create: `tests/js/sender.test.js`
- Create: `js/analytics.js`

**Step 5.1: Write failing tests for the sender**

`tests/js/sender.test.js`:

```js
/**
 * @jest-environment jsdom
 */
const { sendEvent, _envelope } = require('../../js/analytics');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  navigator.sendBeacon = jest.fn().mockReturnValue(true);
});

test('envelope contains required fields', () => {
  const env = _envelope('page_view', { foo: 'bar' });
  expect(env).toMatchObject({
    event: 'page_view',
    visitor_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    page_path: expect.any(String),
    device: expect.stringMatching(/^(mobile|tablet|desktop)$/),
    ab_variant: expect.any(String),
    properties: { foo: 'bar' },
  });
});

test('sendEvent uses sendBeacon when available', () => {
  sendEvent('page_view', {});
  expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('sendEvent falls back to fetch when sendBeacon missing', () => {
  delete navigator.sendBeacon;
  sendEvent('page_view', {});
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('sendEvent does not throw when storage is blocked', () => {
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('blocked'); };
  expect(() => sendEvent('page_view', {})).not.toThrow();
  Storage.prototype.setItem = origSet;
});
```

**Step 5.2: Run test, expect FAIL**

```bash
npx jest tests/js/sender.test.js
```

**Step 5.3: Implement analytics.js**

`js/analytics.js`:

```js
// Jay's Air Center analytics client.
// - Self-hosted: posts events to /api/track (Netlify Function).
// - Cookieless: visitor_id in localStorage, session_id in sessionStorage.
// - Sticky A/B variant per visitor for CTA copy testing.
// - Fail-closed: if storage is blocked, all calls silently no-op.

const ENDPOINT = '/api/track';

const CTA_VARIANTS = [
  { id: 'join_waitlist',        text: 'Join Waitlist' },             // control
  { id: 'reserve_your_hangar',  text: 'Reserve Your Hangar' },       // variant A
  { id: 'inquire_availability', text: 'Inquire About Availability' } // variant B
];
const VARIANT_IDS = CTA_VARIANTS.map(v => v.id);

// --- identity (inlined from identity.js so the browser only loads one file) ---
function _hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function _uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function _safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

function _vid() {
  return _safe(() => {
    let id = localStorage.getItem('jac_vid');
    if (!id) { id = _uuidv4(); localStorage.setItem('jac_vid', id); }
    return id;
  }, _uuidv4());  // if storage blocked, still emit but unstable
}
function _sid() {
  return _safe(() => {
    let id = sessionStorage.getItem('jac_sid');
    if (!id) { id = _uuidv4(); sessionStorage.setItem('jac_sid', id); }
    return id;
  }, _uuidv4());
}
function _variant() {
  return _safe(() => {
    const sticky = localStorage.getItem('jac_ab');
    if (sticky && VARIANT_IDS.includes(sticky)) return sticky;
    const chosen = VARIANT_IDS[_hash(_vid()) % VARIANT_IDS.length];
    localStorage.setItem('jac_ab', chosen);
    return chosen;
  }, VARIANT_IDS[0]);
}

// --- env detection ---
function _device() {
  const w = window.innerWidth;
  if (w < 640) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}
function _utm() {
  const p = new URLSearchParams(location.search);
  const src = p.get('utm_source'), med = p.get('utm_medium'), cmp = p.get('utm_campaign');
  return (src || med || cmp) ? { source: src, medium: med, campaign: cmp } : null;
}

function _envelope(event, properties) {
  return {
    event,
    visitor_id: _vid(),
    session_id: _sid(),
    page_path: location.pathname,
    referrer: document.referrer || null,
    utm: _utm(),
    device: _device(),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    ab_variant: _variant(),
    properties: properties || {},
  };
}

function sendEvent(event, properties) {
  try {
    const payload = JSON.stringify(_envelope(event, properties));
    if (navigator.sendBeacon) {
      // sendBeacon survives page unload — critical for tracking external_click + form_submit
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
    } else {
      // keepalive: true so the request survives navigation
      fetch(ENDPOINT, { method: 'POST', body: payload, headers: { 'content-type': 'application/json' }, keepalive: true })
        .catch(() => {});
    }
  } catch {
    // fail-closed: never throw out of analytics
  }
}

// --- DOM bindings (auto-init on DOMContentLoaded) ---
function _applyCtaVariant() {
  const variant = CTA_VARIANTS.find(v => v.id === _variant());
  if (!variant) return;
  document.querySelectorAll('[data-cta]').forEach(el => { el.textContent = variant.text; });
}

function _bindCtaClicks() {
  document.querySelectorAll('[data-cta]').forEach(el => {
    el.addEventListener('click', () => {
      sendEvent('cta_clicked', {
        cta_location: el.dataset.ctaLocation || 'unknown',
        cta_text: el.textContent.trim(),
      });
    });
  });
}

function _bindFormLifecycle() {
  const form = document.getElementById('contactForm');
  if (!form) return;
  let started = false;
  form.querySelectorAll('input, textarea, select').forEach(field => {
    field.addEventListener('focus', () => {
      if (!started) { started = true; sendEvent('form_started', {}); }
    }, { once: true });
  });
  form.addEventListener('submit', (e) => {
    // form_submitted fires only after browser-native validation passes
    if (form.checkValidity()) {
      const interest = form.querySelector('[name="interest"]')?.value || null;
      sendEvent('form_submitted', { interest });
    }
  });
}

function _bindSectionViews() {
  if (!('IntersectionObserver' in window)) return;
  const fired = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const id = entry.target.dataset.section;
      if (!id || fired.has(id)) return;
      if (entry.intersectionRatio >= 0.5) {
        // 1s dwell filter: confirm still in view after a second
        setTimeout(() => {
          const r = entry.target.getBoundingClientRect();
          const stillVisible = r.top < window.innerHeight * 0.8 && r.bottom > window.innerHeight * 0.2;
          if (stillVisible) {
            fired.add(id);
            sendEvent('section_viewed', { section: id });
          }
        }, 1000);
      }
    });
  }, { threshold: [0.5] });
  document.querySelectorAll('[data-section]').forEach(el => io.observe(el));
}

function _bindExternalClicks() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('tel:')) sendEvent('external_click', { kind: 'phone', href });
    else if (href.startsWith('mailto:')) sendEvent('external_click', { kind: 'email', href });
    else if (href.includes('google.com/maps')) sendEvent('external_click', { kind: 'maps', href });
  });
}

function init() {
  _applyCtaVariant();
  _bindCtaClicks();
  _bindFormLifecycle();
  _bindSectionViews();
  _bindExternalClicks();
  sendEvent('page_view', {});
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Expose for thanks.html and debugging
  window.JacAnalytics = { sendEvent, _variant, CTA_VARIANTS };
}

// CommonJS export for jest
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sendEvent, _envelope };
}
```

**Step 5.4: Run test, expect PASS**

```bash
npx jest tests/js/sender.test.js
```

**Step 5.5: Run full test suite to confirm nothing else broke**

```bash
npm test
```

**Step 5.6: Commit**

```bash
git add tests/js/sender.test.js js/analytics.js
git commit -m "feat(jays-air-center-website): analytics client + A/B variant CTA injection"
```

---

## Task 6: Wire `index.html` — script tag, data attributes, form _next

**Files:**
- Modify: `index.html`

**Step 6.1: Add script tag at end of body**

Insert just before `</body>` (use `Grep` first to confirm only one `</body>`):

```html
    <script src="js/analytics.js" defer></script>
</body>
```

**Step 6.2: Add `data-cta` and `data-cta-location` to BOTH CTAs**

Line ~164 (nav CTA):
```html
<a id="nav-cta" data-cta data-cta-location="nav" href="#contact" class="bg-charcoal text-warm-white px-5 lg:px-7 py-2.5 lg:py-3 font-body text-[15px] font-light tracking-wide hover:bg-deep-navy transition-colors">
    Join Waitlist
</a>
```

Line ~634 (section heading — also gets `data-cta` so it gets variant-swapped):
```html
<h2 id="contact-cta" data-cta class="font-heading text-3xl lg:text-4xl font-light leading-tight mb-8">
    Join the Waitlist
</h2>
```

Note: Both CTAs will receive the SAME variant text from `_applyCtaVariant()`. This is intentional — the visitor sees consistent CTA copy across the page.

**Step 6.3: Add `data-section` to each major section for engagement tracking**

For each `<section id="...">` in the file (Grep first to find them), add `data-section="<id>"`:

```html
<section id="hangars" data-section="hangars" class="...">
<section id="fbo" data-section="fbo" class="...">
<section id="office-space" data-section="office-space" class="...">
<section id="tie-downs" data-section="tie-downs" class="...">
<section id="contact" data-section="contact" class="...">
```

(The `id` and `data-section` are intentionally redundant — `id` drives anchor scrolling, `data-section` drives analytics. Keep them in sync.)

**Step 6.4: Update form action to add `_next` redirect**

Find line ~639 with the form action, change:
```html
<form id="contactForm" name="contact" method="POST" action="https://formsubmit.co/george@jaysaircenter.com" class="space-y-6 text-left">
```
To:
```html
<form id="contactForm" name="contact" method="POST" action="https://formsubmit.co/george@jaysaircenter.com" class="space-y-6 text-left">
    <input type="hidden" name="_next" value="https://www.jaysaircenter.com/thanks.html">
    <input type="hidden" name="_subject" value="New Jay's Air Center Inquiry">
```
(Keep existing `_subject` and `_captcha` hidden inputs. Add `_next` as the first hidden input.)

**Important:** Confirm the production URL — if the site lives at a different domain (e.g., `jays-air-center.netlify.app`), update the `_next` value accordingly. Check `netlify.toml` and Netlify dashboard for the primary domain.

**Step 6.5: Verify changes**

```bash
grep -n 'data-cta\|data-section\|_next' index.html
```

Expect: ~7 matches (2 CTAs, 5 sections, 1 _next input).

**Step 6.6: Commit**

```bash
git add index.html
git commit -m "feat(jays-air-center-website): wire analytics tracking + A/B variant slots"
```

---

## Task 7: Branded thank-you page (`thanks.html`)

**Why:** Fires `form_completed` (the final funnel event) AND gives users a confident on-brand confirmation rather than dropping them on formsubmit.co's generic page.

**Files:**
- Create: `thanks.html`

**Step 7.1: Create thanks.html**

`thanks.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex,nofollow">
    <title>Thank You | Jay's Air Center</title>
    <meta name="description" content="Thank you for your inquiry with Jay's Air Center at John Wayne Airport.">
    <link rel="stylesheet" href="css/output.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600&family=Cormorant:wght@300;400;500;600&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
    <style>
        @font-face {
            font-family: 'Posterama';
            src: url('fonts/posterama-2001-thin.woff2') format('woff2'),
                 url('fonts/posterama-2001-thin.woff') format('woff');
            font-weight: 100;
            font-style: normal;
            font-display: swap;
        }
        body {
            font-family: 'DM Sans', sans-serif;
            background-color: #F8F6F3;
            color: #1A1A1A;
            font-weight: 400;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .logo-text {
            font-family: 'Posterama', sans-serif;
            font-weight: 100;
            letter-spacing: 0.15em;
            word-spacing: 0.25em;
            text-transform: uppercase;
            white-space: nowrap;
            line-height: 1;
        }
        .font-heading { font-family: 'Cinzel', serif; }
        .font-body { font-family: 'DM Sans', sans-serif; }
    </style>
</head>
<body>
    <nav class="px-6 md:px-8 lg:px-12 h-20 lg:h-24 flex items-center justify-center border-b border-soft-gray">
        <a href="/" class="logo-text text-[1.15rem] md:text-[1.35rem] text-charcoal">Jay's Air Center</a>
    </nav>

    <main class="flex-1 flex items-center justify-center px-6 md:px-8">
        <div class="max-w-[640px] text-center">
            <div class="mb-8">
                <svg class="w-16 h-16 mx-auto text-charcoal/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                </svg>
            </div>
            <h1 class="font-heading text-4xl lg:text-5xl font-light leading-tight mb-6">
                Thank You
            </h1>
            <p class="text-charcoal/60 font-body text-base lg:text-lg leading-relaxed font-light mb-10">
                Your inquiry has been received. A member of our team will be in touch within 24 hours to discuss how Jay's Air Center can serve your aviation needs.
            </p>
            <a href="/" class="inline-block bg-charcoal text-warm-white px-10 py-4 font-body text-xs tracking-[0.1em] uppercase font-normal hover:bg-deep-navy transition-colors">
                Return to Home
            </a>
        </div>
    </main>

    <footer class="py-8 text-center text-charcoal/40 font-body text-sm font-light">
        Jay's Air Center · 2980 Airway Avenue · Costa Mesa, CA 92626
    </footer>

    <script src="js/analytics.js" defer></script>
    <script>
        // Fire form_completed once analytics has initialized
        document.addEventListener('DOMContentLoaded', () => {
            // Small delay to let analytics.js init and send its own page_view first
            setTimeout(() => {
                if (window.JacAnalytics) {
                    window.JacAnalytics.sendEvent('form_completed', {
                        ab_variant: localStorage.getItem('jac_ab') || null,
                    });
                }
            }, 100);
        });
    </script>
</body>
</html>
```

**Step 7.2: Verify it renders locally**

```bash
npm run dev
# In another terminal:
open http://localhost:3000/thanks.html
```

Visually confirm: branded nav, checkmark icon, "Thank You" heading, "Return to Home" button. Browser DevTools → Application → Local Storage should show `jac_vid` and `jac_ab` after a moment.

**Step 7.3: Commit**

```bash
git add thanks.html
git commit -m "feat(jays-air-center-website): branded thank-you page firing form_completed"
```

---

## Task 8: Privacy notice page (`privacy.html`)

**Files:**
- Create: `privacy.html`

**Step 8.1: Create privacy.html**

`privacy.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy | Jay's Air Center</title>
    <meta name="description" content="Privacy notice for Jay's Air Center.">
    <link rel="stylesheet" href="css/output.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600&family=Cormorant:wght@300;400;500;600&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
    <style>
        @font-face {
            font-family: 'Posterama';
            src: url('fonts/posterama-2001-thin.woff2') format('woff2'),
                 url('fonts/posterama-2001-thin.woff') format('woff');
            font-weight: 100;
            font-style: normal;
            font-display: swap;
        }
        body { font-family: 'DM Sans', sans-serif; background-color: #F8F6F3; color: #1A1A1A; }
        .logo-text { font-family: 'Posterama', sans-serif; font-weight: 100; letter-spacing: 0.15em; word-spacing: 0.25em; text-transform: uppercase; }
        .font-heading { font-family: 'Cinzel', serif; }
    </style>
</head>
<body>
    <nav class="px-6 md:px-8 lg:px-12 h-20 lg:h-24 flex items-center justify-center border-b border-soft-gray">
        <a href="/" class="logo-text text-[1.15rem] md:text-[1.35rem] text-charcoal">Jay's Air Center</a>
    </nav>
    <main class="max-w-[720px] mx-auto px-6 md:px-8 py-16 lg:py-24">
        <h1 class="font-heading text-3xl lg:text-4xl font-light mb-8">Privacy</h1>
        <div class="space-y-6 text-charcoal/80 font-body text-base leading-relaxed font-light">
            <p><strong>Last updated:</strong> 2026-05-22</p>
            <p>Jay's Air Center respects your privacy. This page explains what we collect and why.</p>
            <h2 class="font-heading text-xl font-light mt-10 mb-3">What we collect</h2>
            <p>We use anonymous, cookieless analytics to understand how this site is used. Specifically, we record:</p>
            <ul class="list-disc pl-6 space-y-2">
                <li>Pages viewed and sections scrolled into view</li>
                <li>Clicks on call-to-action buttons and contact links</li>
                <li>Form starts and completions</li>
                <li>Approximate country (from your IP, which is then discarded), device type, and viewport size</li>
                <li>An anonymous random identifier stored in your browser's local storage so we can tell a returning visitor apart from a new one</li>
            </ul>
            <p>We do <em>not</em> use cookies. We do <em>not</em> store your IP address. We do <em>not</em> share any of this data with third parties. The data lives in our own infrastructure.</p>
            <h2 class="font-heading text-xl font-light mt-10 mb-3">What we collect when you fill out our form</h2>
            <p>Information you voluntarily provide through our contact form (name, email, phone, aircraft details, message) is sent directly to our team and is used only to respond to your inquiry. It is not shared.</p>
            <h2 class="font-heading text-xl font-light mt-10 mb-3">Your choices</h2>
            <p>To opt out of the anonymous analytics, you can clear your browser's local storage for this site, or block our analytics endpoint with a browser extension. This will not affect site functionality.</p>
            <h2 class="font-heading text-xl font-light mt-10 mb-3">Contact</h2>
            <p>Questions: <a href="mailto:george@jaysaircenter.com" class="underline">george@jaysaircenter.com</a></p>
        </div>
    </main>
</body>
</html>
```

**Step 8.2: Commit**

```bash
git add privacy.html
git commit -m "feat(jays-air-center-website): privacy notice page"
```

---

## Task 9: Footer link to privacy + netlify.toml CSP update

**Files:**
- Modify: `index.html` (footer)
- Modify: `netlify.toml`

**Step 9.1: Add privacy link in footer**

Find the footer block (~line 694–end). Inside the existing legal/copyright row, add a link to `/privacy.html`. Match existing footer typography. Example:

```html
<a href="/privacy.html" class="text-charcoal/60 hover:text-charcoal transition-colors font-body text-sm">Privacy</a>
```

(Use `Read` to find the exact footer markup before editing, since the file has changed in earlier tasks.)

**Step 9.2: Update CSP in netlify.toml**

The existing CSP allows `default-src 'self'`. The `fetch`/`sendBeacon` call to `/api/track` is same-origin, so `connect-src 'self'` is already implicit via `default-src`. However, we should make it explicit and remove `'unsafe-inline'` for scripts if possible (defense in depth).

Conservative change (keep `'unsafe-inline'` to avoid breaking existing inline styles/scripts):

```toml
Content-Security-Policy = "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self'; frame-src https://www.google.com/maps/"
```

(Adds explicit `connect-src 'self'`. All else unchanged.)

**Step 9.3: Add functions directive AND /api rewrite to netlify.toml**

Functions ship at `/.netlify/functions/<name>` by default. The client posts to `/api/track`, so a server-side rewrite is required — without this, all events 404 in production.

```toml
[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

**Step 9.4: Verify Netlify functions config**

```bash
npx netlify dev --offline &
sleep 5
curl -i -X POST http://localhost:8888/api/track \
  -H 'content-type: application/json' \
  -d '{"event":"page_view","visitor_id":"00000000-0000-4000-8000-000000000001","session_id":"00000000-0000-4000-8000-000000000002"}'
kill %1
```

Expected: HTTP 500 (because FIREBASE_SERVICE_ACCOUNT_JSON is missing locally, which is fine) OR HTTP 202 (if you've set it locally). HTTP 404 means the function isn't being picked up — fix the `[functions]` config or path.

**Step 9.5: Commit**

```bash
git add index.html netlify.toml
git commit -m "feat(jays-air-center-website): privacy footer link + CSP connect-src + functions dir"
```

---

## Task 10: Local smoke test

**No new files. Pure verification.**

**Step 10.1: Build CSS**

```bash
npm run build
```

**Step 10.2: Run dev server**

```bash
npm run dev
```

**Step 10.3: Open in browser, walk the funnel**

Open http://localhost:3000.

In browser DevTools → Application → Local Storage, confirm:
- `jac_vid` appears (UUID v4)
- `jac_ab` appears (one of: `join_waitlist`, `reserve_your_hangar`, `inquire_availability`)

In DevTools → Application → Session Storage:
- `jac_sid` appears (UUID v4)

In DevTools → Network, filter on `/api/track`:
- 1 `page_view` event fires on load
- Scroll through Hangars / FBO / Office / Contact sections → `section_viewed` events fire
- Click the nav CTA → `cta_clicked` event fires with the variant text
- Click into a form field → `form_started` event fires
- Fill + submit the form → `form_submitted` fires; you should be redirected to `/thanks.html`; on that page `form_completed` fires

Local Netlify Function will fail Firestore writes unless you've set `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env` — that's OK for the smoke test, we're verifying the client side fires events correctly. Check that requests are MADE, not that they succeed end-to-end locally.

**Step 10.4: Confirm CTA variant is consistent**

Reload the page 5 times. The CTA text should NOT change between reloads (sticky variant). The text should match `localStorage.jac_ab`.

To verify variant assignment is working, run in console:
```js
localStorage.removeItem('jac_ab');
localStorage.removeItem('jac_vid');
location.reload();
```
A new variant should be assigned. Repeat 6-10 times — you should see all three variants assigned over multiple clears.

**Step 10.5: Run full test suite one more time**

```bash
npm test
```

Expected: all green.

**Step 10.6: No commit (verification-only task)**

---

## Task 11: Deploy to Netlify + production verification

**No new files. Deploy + observe.**

**Step 11.1: Confirm env var is set in Netlify production**

```bash
npx netlify env:list
```

Expected: `FIREBASE_SERVICE_ACCOUNT_JSON` appears with a non-empty value.

**Step 11.2: Deploy**

```bash
./scripts/deploy.sh
# OR
npm run build && npx netlify deploy --prod
```

**Step 11.3: Verify in production**

Open https://www.jaysaircenter.com (or the production URL).

DevTools → Network → filter `track`:
- Confirm `POST /api/track` returns 202 (not 500, not 404)

**Step 11.4: Verify Firestore has events**

In Firebase Console → `openavdb-prod` project → Firestore → database `openavdb` → collection `jac_analytics_events`:

```
https://console.firebase.google.com/project/openavdb-prod/firestore/databases/openavdb/data/~2Fjac_analytics_events
```

Expect: at least one `page_view` document within ~30 seconds of your production visit, with all expected fields populated (`ab_variant`, `country`, `device`, etc.).

**Step 11.5: Submit a real form to verify end-to-end funnel**

Submit the contact form with a test entry (use your own email). Confirm:
1. You land on `/thanks.html`
2. Firestore shows `form_submitted` AND `form_completed` events for your visitor_id
3. George receives the form submission via formsubmit.co (existing behavior, should be unaffected)

**Step 11.6: Open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: analytics + A/B test for Jay's Air Center CTA" --body "$(cat <<'EOF'
## Summary
- Self-hosted analytics: Netlify Function -> Firestore (openavdb DB)
- 7-event conversion funnel: page_view, section_viewed, cta_clicked, form_started, form_submitted, form_completed, external_click
- Cookieless visitor + session identity, country from edge headers
- 3-variant CTA A/B test: Join Waitlist (control) | Reserve Your Hangar | Inquire About Availability
- Branded /thanks.html for confirmed form completion
- Privacy notice at /privacy.html

Design doc: apps/jays-air-center-website/docs/plans/2026-05-22-jac-analytics-cta-optimization-design.md

## Test plan
- [x] Unit tests for identity (UUID stability, variant determinism, distribution)
- [x] Unit tests for sender (envelope shape, sendBeacon, fetch fallback, fail-closed)
- [x] Unit tests for Netlify Function (schema validation, payload size)
- [x] Local smoke test: full funnel events fire in DevTools network tab
- [ ] Production: page_view appears in Firestore within 30s of deploy
- [ ] Production: form_completed appears in Firestore after real form submission
- [ ] Production: George receives form submission via formsubmit.co (regression)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 11.7: Monitor for 24h**

After deploy, query Firestore at the 24h mark and confirm:
- `page_view` count > 0 (site is receiving traffic)
- All 3 `ab_variant` values are appearing in roughly equal proportions (within ~10% of 33%)
- No `event` values appear that aren't in the allowed list (would indicate ingest bug)

If variant distribution is severely skewed (one variant <20%), investigate the hash function or check whether stale visitors with old `jac_ab` values are dragging the distribution.

---

## Acceptance criteria

The implementation is done when ALL of these are true:

1. `npm test` passes cleanly (no skips, no warnings)
2. Production `/api/track` returns 202 for valid payloads, 400/413 for invalid
3. Firestore receives at least one `page_view`, `cta_clicked`, and `form_completed` event after a real production walk-through
4. All three A/B variants are visible to users (manually clear localStorage 5+ times to confirm)
5. CSP allows the analytics call without console errors
6. No regression in form deliverability — George confirms a test inquiry arrives in his inbox
7. Lighthouse score on the home page does not drop by more than 2 points (analytics overhead should be minimal)

---

## Out of scope (do NOT implement in this PR)

- Dashboard UI
- Rate limiting / bot filtering on `/api/track`
- Netlify Forms migration
- Round-two CTA tests
- Conversion-significance calculator (use a 2-prop z-test by hand from Firestore export)
