# Jay's Valet — MVP Setup Runbook

**For:** the functional valet PWA at `valet/app/`
**Backend:** 100% Netlify — Netlify Functions + Netlify Blobs. **No Google Cloud,
no AWS, no Firebase, no third-party account to sign up for.**
**Last reviewed:** 2026-06-03

This app is a **PWA** (installable web app). It runs today on any phone via the
browser "Add to Home Screen". A native iOS App Store build (Capacitor wrap) is a
later step gated on the Apple Developer account.

---

## How it works

| Concern | Tech | Notes |
|---|---|---|
| **Data storage** | **Netlify Blobs** | Built into Netlify. Zero config, no credentials, no separate cloud account. Stores users + requests as JSON. |
| **API** | **Netlify Functions** | `valet-auth` (login/signup/session) and `valet-requests` (queue CRUD), routed via the existing `/api/*` rewrite. |
| **Auth** | Signed HttpOnly cookie | Passwords scrypt-hashed in Blobs. No identity provider. |
| **Realtime** | ~3s polling | Customer + operator views poll `/api/valet-requests`. Same-origin, so it works under the site's strict `connect-src 'self'` CSP. |
| **Notifications** | In-app banners | Status changes pop an in-app banner. No OS push, no service worker messaging, nothing to permission. |

There is **nothing to configure to go live** — deploy to Netlify and it works.
Open the app locally with a plain static server and it automatically runs in
**DEMO mode** (in-memory, no backend) so it's always clickable and shareable.

---

## Going live (just deploy)

1. Push to the branch Netlify builds. The two functions deploy automatically;
   Netlify Blobs is provisioned on first write — no dashboard step.
2. (Recommended) Set a stable session secret so cookies survive redeploys:
   - Netlify → Site settings → Environment variables → add
     **`VALET_SESSION_SECRET`** = any long random string.
   - If unset, a built-in dev default is used (fine for a shared demo; set it
     before anything resembling production).
3. Visit `https://<your-site>/valet/app/`.

### Seed accounts (created automatically on first run)

| Role | Email | Password |
|---|---|---|
| Owner | `owner@jaysair.test` | `valet123` |
| Line operator | `operator@jaysair.test` | `valet123` |
| Tenant | `tenant@jaysair.test` | `valet123` |

Tenants can also self-sign-up from the app's **Create an account** screen. To do
a real two-person play-through: open the owner login on a phone, the operator
login on a laptop, and watch requests flow between them live.

---

## Local development

Live backend (functions + Blobs) locally:
```bash
cd jays-air-center-website
npx netlify dev        # http://localhost:8888  → open /valet/app/
```

Demo mode (no functions, instant, for quick UI work / sharing a static build):
```bash
npx serve .            # open /valet/app/ — auto-detects no API and runs DEMO
```

The app probes `/api/valet-auth` on boot: if it answers, it runs **live**; if not
(plain static serving), it falls back to **demo**. No flags, no config file.

## Cost

Netlify free tier covers hosting, Functions, and Blobs at an FBO's volume (tens
of requests/day, a handful of operators). **Expected monthly cost: $0** until
volume grows substantially. No other vendor is involved.
