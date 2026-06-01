# Jay's Air Center — Analytics + CTA Optimization Design

**Date:** 2026-05-22
**Owner:** Daniel G. Hernandez (H9 Partners)
**Status:** Approved (brainstorming phase complete)
**Goal:** Instrument the site to measure visitor volume, engagement, and CTA conversion. A/B test three CTA variants from day one to optimize click-through and form-completion rates.

---

## Problem

The current "Join Waitlist" CTA at Jay's Air Center is not driving the expected volume of inquiries. We have no instrumentation to know:

- How many people visit the site
- Which sections they engage with
- How many click the CTA
- How many complete the form

Without this baseline, we cannot tell whether the underperformance is a traffic problem, an engagement problem, or a CTA-copy problem.

## Goals

1. **Baseline measurement** — Establish visit, engagement, and conversion-funnel metrics that persist across redeploys.
2. **Privacy-respecting** — No cookies, no PII storage, no third-party trackers, no consent banner blocking the experience.
3. **CTA optimization** — A/B test three CTA variants and measure relative lift on form completion.
4. **Reuse existing infrastructure** — Self-hosted on Netlify Functions + Firestore (the AvDB stack) rather than introducing a new SaaS dependency.

## Non-goals (for this PR)

- Dashboard UI (deferred; query Firestore from the Firebase console for the first 2–4 weeks)
- Real-time alerts
- Heatmaps or session replay
- Migration off formsubmit.co
- CCPA/GDPR consent banner (not required for the anonymous, no-PII model)

---

## Architecture

```
Browser ──[POST /api/track]──► Netlify Function ──[firebase-admin]──► Firestore
                                                                          │
                                                                          ▼
                                                              jac_analytics_events
                                                              (project: openavdb-prod,
                                                               database: openavdb)
```

- Browser never holds Firestore credentials.
- Service-account JSON lives in Netlify env var `FIREBASE_SERVICE_ACCOUNT_JSON` (base64).
- Edge headers provide country + device hints server-side; no IP storage.
- Single ingest chokepoint enables rate limiting and bot filtering later.

### Identity model

| Key       | Storage         | Purpose                  | Lifetime                |
|-----------|-----------------|--------------------------|-------------------------|
| `jac_vid` | localStorage    | Anonymous visitor UUID   | Persists across sessions |
| `jac_sid` | sessionStorage  | Session UUID             | New per tab / 30 min idle |
| `jac_ab`  | localStorage    | Sticky A/B variant       | Persists across sessions |

No cookies. No PII. Country derived from edge header server-side and discarded with the IP.

---

## Events tracked

| # | Event             | Fires when                                                                | Why it matters                                  |
|---|-------------------|---------------------------------------------------------------------------|-------------------------------------------------|
| 1 | `page_view`       | Page load                                                                 | Top-of-funnel volume                            |
| 2 | `section_viewed`  | Section enters viewport (IntersectionObserver, ≥50% visible, ≥1s dwell)   | Real engagement vs. bounce                      |
| 3 | `cta_clicked`     | Nav CTA or section CTA clicked                                            | Primary CTA performance                         |
| 4 | `form_started`    | First focus on any form field                                             | Did the click translate to intent?              |
| 5 | `form_submitted`  | Send button clicked, client-side validation passed                        | Attempt rate                                    |
| 6 | `form_completed`  | Visitor lands on `/thanks.html` after formsubmit `_next` redirect         | **True conversion** (server accepted the form) |
| 7 | `external_click`  | Phone `tel:`, email `mailto:`, Google Maps link                           | Off-site intent signal                          |

**Computed funnel:** `page_view → section_viewed → cta_clicked → form_started → form_completed`

### Event schema (Firestore doc shape)

```js
{
  event: "cta_clicked",
  ts: <Firestore Timestamp>,
  visitor_id: "uuid-v4",
  session_id: "uuid-v4",
  page_path: "/",
  referrer: "https://google.com/" | null,
  utm: { source, medium, campaign } | null,
  device: "mobile" | "tablet" | "desktop",
  viewport: { w: 1440, h: 900 },
  country: "US",                       // from Netlify edge header, server-side
  ab_variant: "reserve_your_hangar",   // current sticky bucket
  properties: {                        // event-specific
    cta_location: "nav" | "section",
    cta_text: "Reserve Your Hangar"
  }
}
```

Single collection: `jac_analytics_events` (no sub-collections, keep aggregation simple).

---

## A/B testing the CTA

A single `CTA_VARIANTS` config at the top of `analytics.js`:

```js
const CTA_VARIANTS = [
  { id: "join_waitlist",        text: "Join Waitlist" },             // control
  { id: "reserve_your_hangar",  text: "Reserve Your Hangar" },       // variant A
  { id: "inquire_availability", text: "Inquire About Availability" } // variant B
];
```

**Assignment:** `getVariant(visitor_id)` = deterministic hash of `visitor_id` → bucket index. Once assigned, stored under `jac_ab` so a visitor sees the same variant on return visits.

**DOM injection:** CTA text in nav (`#nav-cta`) and section heading (`#contact h2`) is set at page load by `analytics.js`.

**Decision rule:** Run until one of (a) any variant beats control by ≥20% relative lift on `form_completed / cta_clicked` with n≥100/arm, or (b) 4 weeks elapsed. Use a two-proportion z-test for significance.

### CTA copy rationale

| # | CTA                              | Hypothesis                                                                                              |
|---|----------------------------------|---------------------------------------------------------------------------------------------------------|
| 1 | Join Waitlist (control)          | Current baseline. Underperforms — implies passive waiting, dilutes exclusivity, communicates no benefit. |
| 2 | Reserve Your Hangar              | Possession framing ("your"), specificity (the headline service), scarcity implied. NetJets/Tesla pattern. |
| 3 | Inquire About Availability       | Luxury-appropriate (Aman, Ferrari, Rolex use "inquire"), lowest perceived friction, signals dialogue.   |

Other variants considered but not tested in round one (kept for future rounds): "Schedule a Private Tour", "Request Hangar Access", "Secure Priority Access", "Request Membership", "Begin Your Reservation", "Get Early Access".

---

## Persistence guarantees

| Data                       | Lives in                  | Survives Netlify redeploy? |
|----------------------------|---------------------------|----------------------------|
| Events                     | Firestore                 | ✅                         |
| Visitor IDs                | User's browser localStorage | ✅                       |
| A/B assignments            | User's browser localStorage | ✅ (key versioned)        |
| Service-account credentials | Netlify env vars         | ✅                         |

Nothing analytics-related lives in the static bundle, so redeploys are non-destructive.

---

## File changes

```
NEW    netlify/functions/track.js        # Event ingest endpoint
NEW    js/analytics.js                   # Client library (~200 LOC)
NEW    thanks.html                       # Branded post-submit page (fires form_completed)
NEW    privacy.html                      # Privacy notice
MOD    index.html                        # +script tag, +data-track attrs, form _next param, CTA id
MOD    netlify.toml                      # CSP connect-src 'self', functions dir
MOD    package.json                      # +firebase-admin, +uuid
```

Total: 3 new files in app code, 1 new branded page, 1 privacy page, 3 modifications. Estimated ~300–400 lines net.

---

## Privacy & compliance

- **No cookies.** Pure localStorage/sessionStorage.
- **No PII.** Anonymous UUIDs, no name/email captured in analytics. The form submission itself goes to formsubmit.co as before — analytics only captures the event, not the form contents.
- **No third-party trackers.** Self-hosted ingest.
- **Footer notice:** "We use anonymous, cookieless analytics to improve this site." Link to `/privacy.html`.
- **CCPA:** No "sale" of personal information, no third-party sharing → no opt-out link required.
- **GDPR:** Anonymous analytics with no identifiers tying to a person is widely considered legitimate-interest processing; no consent gate.

---

## Testing

- **Manual:** Open site → confirm `page_view` in Firestore → scroll → confirm `section_viewed` → click CTA → confirm `cta_clicked` with `ab_variant` populated → submit form → confirm redirect to `/thanks.html` → confirm `form_completed` in Firestore.
- **Automated (smoke test in `tests/`):** JSDOM test for `analytics.js` — verify event payload shape, visitor/session ID stability, variant assignment determinism.
- **Negative:** Run with `localStorage` blocked → analytics should fail closed (no events fire, no crash, no console error visible to user).

---

## Rollout

1. Build + deploy to Netlify with feature gated behind absence of traffic — i.e., it ships dormant until real users hit the production URL. No staging needed (zero risk to UX; pure additive instrumentation).
2. Verify Firestore receives events within 30 minutes of deploy.
3. Let baseline run for 2 weeks before reading variant results.
4. After 4 weeks or n≥100/arm, declare a winner and remove losing variants from `CTA_VARIANTS`.

---

## Open follow-ups (NOT in this PR)

- Dashboard UI at `/admin/analytics.html` (password-gated). Build after 2–4 weeks of data when we know which views matter.
- Rate limiting on `/api/track` (only if we see abuse).
- Migration off formsubmit.co to Netlify Forms or direct SMTP (separate concern).
- Round-two CTA tests with the winning variant as the new control.

---

## Next step

Invoke `superpowers:writing-plans` skill to produce a step-by-step implementation plan from this design.
