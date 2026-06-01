# Firebase Service Account Runbook

**For:** Jay's Air Center website — analytics ingest Netlify Function (`netlify/functions/track.js`)
**Last reviewed:** 2026-05-22

## Why

The `/api/track` Netlify Function writes events to Firestore in the `openavdb-prod` Firebase project (named database `openavdb`). To authenticate server-side, it reads a base64-encoded Firebase service-account JSON from the Netlify environment variable `FIREBASE_SERVICE_ACCOUNT_JSON`.

We use base64 encoding so the multi-line JSON survives Netlify's environment-variable UI without escaping issues.

## One-time setup

### 1. Generate the service-account key

1. Open https://console.firebase.google.com/project/openavdb-prod/settings/serviceaccounts/adminsdk
2. Click **"Generate new private key"** → **"Generate key"**
3. Save the downloaded JSON file as `~/Downloads/openavdb-prod-sa.json`
4. **Do not commit this file.** It grants admin access to all Firestore data in `openavdb-prod`.

### 2. Encode and set the Netlify env var

```bash
# Base64-encode (single line, no newlines — important for some Netlify CLI versions)
SA_B64=$(base64 -i ~/Downloads/openavdb-prod-sa.json | tr -d '\n')

# Confirm it decodes correctly before pushing
echo "$SA_B64" | base64 -d | jq -e '.project_id' | grep openavdb-prod

# Set on the Netlify production context
cd apps/jays-air-center-website
npx netlify env:set FIREBASE_SERVICE_ACCOUNT_JSON "$SA_B64" --context production

# Verify it was set (the value won't print)
npx netlify env:list
```

### 3. Securely delete the local SA file

```bash
# macOS: srm is removed in newer versions; use rm + APFS doesn't need overwrite
rm ~/Downloads/openavdb-prod-sa.json

# Verify it's gone
ls ~/Downloads/openavdb-prod-sa.json 2>/dev/null && echo "STILL THERE" || echo "DELETED"
```

### 4. (Optional) Set for deploy-preview context too

Useful if you want analytics to also work in PR previews:

```bash
npx netlify env:set FIREBASE_SERVICE_ACCOUNT_JSON "$SA_B64" --context deploy-preview
```

## Local development

To test the function locally against real Firestore (instead of the mocked Jest tests), set the env var in a local `.env` file:

```bash
# In apps/jays-air-center-website/.env (gitignored)
FIREBASE_SERVICE_ACCOUNT_JSON=<paste base64 value here>
```

Then run `npx netlify dev` — the function will pick up the env var from `.env` automatically.

**Do NOT commit `.env`.** Confirm it's in `.gitignore`.

## Rotation

Rotate the service-account key any time:
- Someone with access to the local SA file leaves the project
- Suspected compromise
- Routine quarterly rotation

### Rotation procedure

1. In Firebase Console (link above), generate a **new** key.
2. Run the encode + env-set commands from "One-time setup" with the new file.
3. Trigger a Netlify redeploy so the function picks up the new env var (or wait for the next deploy).
4. Once you've confirmed events are landing in Firestore with the new key, return to Firebase Console and **delete the old key** under "Service accounts → openavdb-prod" → key list.

## Verification (after setup)

After setting the env var and deploying:

```bash
curl -i -X POST https://www.jaysaircenter.com/api/track \
  -H 'content-type: application/json' \
  -d '{
    "event": "page_view",
    "visitor_id": "00000000-0000-4000-8000-000000000001",
    "session_id": "00000000-0000-4000-8000-000000000002",
    "page_path": "/",
    "device": "desktop",
    "viewport": {"w": 1440, "h": 900},
    "ab_variant": "join_waitlist",
    "properties": {}
  }'
```

Expected: `HTTP/2 202` and body `{"ok":true}`.

If you see `500` with `"error":"write failed"`, check:
- The env var is set in the correct context (production)
- The service account has the **Cloud Datastore User** role on `openavdb-prod`
- The named database `openavdb` exists (NOT the default `(default)` database)

Then check the latest event in Firestore:
https://console.firebase.google.com/project/openavdb-prod/firestore/databases/openavdb/data/~2Fjac_analytics_events

## Why the named database matters

The `openavdb-prod` project uses a **named** Firestore database called `openavdb`, not the default `(default)` database. The function MUST call `getFirestore('openavdb')` — without the argument, it will try to write to `(default)` and fail with a 404.

This is the same convention the rest of the AvDB platform uses (see root `CLAUDE.md` → "Named Database" warning).
