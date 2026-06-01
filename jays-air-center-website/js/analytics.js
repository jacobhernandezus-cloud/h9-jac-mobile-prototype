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
