# Jay's Valet — Aircraft Staging App
### Product Concept & Requirements (single source of truth)

**Owner:** Jacob Hernandez · **Stakeholder:** George · **Client:** Jay's Air Center (FBO, John Wayne Airport / KSNA)
**Status:** Concept + clickable prototype · **Last updated:** 2026-06-01 (rev 2 — incorporates team feedback)

---

## 1. The one-liner

> **"Summon your plane like a Tesla."** An owner or tenant requests staging or schedules an
> arrival, the line operator pulls the aircraft from the hangar, fuels and stages it on the
> ramp (or meets it on arrival and parks it), and the customer gets a push notification at
> every step.

Inspired by the **Tesla app ("Summon")** and **robotaxi** flows: one tap, live status,
arrives ready. We are digitizing the phone call customers make today to Jay's line crew.

---

## 2. Why this exists

Today a customer calls the front desk: "pull 5-niner-Charlie out, top off the fuel, I'm
leaving at 9." That request is verbal, untracked, and the customer has no visibility into
status. The valet app:

- **Removes the phone call** — request from the app.
- **Gives live status** — Requested → Operator assigned → Towing → Fuel & services → **Staged & ready**.
- **Notifies on every change** — push notification with the ramp spot.
- **Smooths ramp traffic** — departures are **scheduled only (2-hour minimum lead)** so the
  line isn't slammed by last-minute requests.
- **Pulls arrivals forward** — owners can **schedule an arrival** and then **announce** it on
  final, so the operator is ready when they taxi in (more predictable business for Jay's).
- **Lets customers thank the operator** — optional electronic tip (Version A only).

---

## 3. Personas (formalized)

Three personas define **who can do what** in the app.

### 3.1 Owner
A based aircraft owner with a hangar at Jay's. Full customer experience.
- **Responsibilities:** manages their own aircraft; requests staging and arrivals; pays via account.
- **Enabled:** request staging, schedule arrival, announce arrival, return to ramp, fuel & services, tipping (Version A), activity history, account billing.
- **Disabled:** operator/ops tools.

### 3.2 Line operator (Jay's ground staff)
The lineman who physically moves, fuels, and parks aircraft.
- **Responsibilities:** works the request queue; updates status; fuels and stages/parks aircraft.
- **Enabled:** see incoming queue, accept/reassign jobs, advance status (tow → fuel → staged/parked), which fires the customer's notifications.
- **Disabled:** requesting service for an aircraft, tipping, billing. Operators **receive** tips, they don't send them.

### 3.3 Tenant
A renter who leases a hangar or tie-down but may not be a full account owner. Onboards via
**in-app sign-up**.
- **Responsibilities:** registers as a tenant (name, email, tail number, aircraft type, lease); uses valet service for their leased aircraft; **billed per use**.
- **Enabled:** same request flows as Owner (staging, arrival, return, fuel & services, tipping), scoped to their aircraft.
- **Disabled:** operator tools; multi-aircraft / flight-department admin; account-level billing settings (charges are per-use).

### Feature-access matrix

| Feature | Owner | Tenant | Line operator |
|---|:---:|:---:|:---:|
| Sign-up / self-registration | — (pre-provisioned) | ✅ (in-app) | — (staff provisioned) |
| Request aircraft staging | ✅ | ✅ | — |
| Schedule arrival / Announce arrival | ✅ | ✅ | — |
| Return aircraft to ramp | ✅ | ✅ | — |
| Fuel & services request | ✅ | ✅ | — |
| Electronic tip (Version A) | ✅ send | ✅ send | ✅ receive |
| Activity history | ✅ | ✅ (own) | — |
| Ops queue / advance status | — | — | ✅ |
| Account billing settings | ✅ | per-use only | — |

---

## 4. Core flows

### 4.1 Departure — "Request aircraft staging"
**Scheduled only.** No "stage now"; departures cannot be scheduled within **2 hours** (keeps
last-minute ramp traffic down). Pick a departure slot → fuel → services → confirm.
```
Request staging → Operator assigned → Towing to ramp → Fuel & services → Staged & ready → (tip/rating)
```

### 4.2 Arrival — "Schedule arrival" + "Announce arrival"
- **Schedule arrival:** pick an ETA slot (limited to ~2 hours out), choose parking (hangar /
  tie-down), request services. Confirmation pops up; a pending-arrival card appears on home.
- **Announce arrival:** tap on final approach ("I'm 15 min out"). Operator is dispatched,
  meets the aircraft, **services are requested before the plane is moved into its parking spot**, then parks it.
```
Announce → Operator dispatched → Meeting aircraft → Fuel & services → Parked & secured → (tip/rating)
```

### 4.3 Return aircraft to ramp
Reposition a parked aircraft back out to the ramp (quick turn), with optional fuel/services.

### 4.4 Fuel options (simplified)
Only **Top off Jet A** and **Top off 100LL**. Each **fills the tank** — the "set quantity"
option was removed for simplicity.

---

## 5. The two versions (required deliverable)

Two variants of the same app, switchable via a single **tipping toggle** in the prototype:

| | **Version A — Concierge** | **Version B — Standard** |
|---|---|---|
| All flows + notifications | ✅ | ✅ |
| **Electronic tipping** | ✅ tip screen after completion | ❌ none |
| Closing screen | Tip → thank-you | Rating / thank-you only |

---

## 6. Feature scope

**MVP (in the prototype):** persona switch (owner / tenant / line operator), tenant sign-up,
request staging (scheduled, 2-hr rule), schedule + announce arrival, return to ramp, fuel
(Jet A / 100LL top-off), services, live status tracker, push notifications, electronic tip
(Version A), light operator queue.

**Roadmap (post-MVP):** real auth (Supabase) + per-user aircraft, real push (APNs) + SMS,
payments + tip payout (Stripe), billing integration with Jay's FBO software, multi-aircraft /
flight-department accounts, operator scheduling + SLA timers, live ramp map.

---

## 7. Key decisions (log)

- **2026-06-01** — Model the core interaction on **Tesla Summon** (one tap, live status, arrives ready).
- **2026-06-01** — Ship **one prototype with a tipping toggle** (A/B), not two codebases.
- **2026-06-01 (rev 2)** — Formalize **three personas**: owner, line operator, tenant, with an explicit feature-access matrix.
- **2026-06-01 (rev 2)** — **Departures are scheduled only**, with a **2-hour minimum lead** to prevent last-minute ramp congestion. Removed "stage now."
- **2026-06-01 (rev 2)** — Rename actions: "Stage aircraft for departure" → **"Request aircraft staging"**; "Return aircraft to hangar" → **"Return aircraft to ramp."**
- **2026-06-01 (rev 2)** — Add an **arrival journey**: "Schedule arrival" (slots ~2 hrs out) + "Announce arrival," with a **request-services step before the aircraft is parked.**
- **2026-06-01 (rev 2)** — **Fuel simplified** to "Top off Jet A" / "Top off 100LL," each fills the tank; removed set-quantity.
- **2026-06-01 (rev 2)** — Add **tenant self-sign-up** so renters can onboard themselves (billed per use).
- **2026-06-01** — Match **Jay's brand** (Cormorant / DM Sans, deep-navy + burnished-gold).

## 8. Open questions for George

1. Tipping in or out for v1? (Drives A vs B.)
2. Is the 2-hour departure minimum the right number, or should it flex by aircraft type / time of day?
3. Should tenant sign-up require Jay's approval before activation, or be instant?
4. Do fuel/services get **billed** through the app, or just **requested**?
5. Existing FBO software to integrate for billing / aircraft data?
6. Operator side — dedicated tablet at the line shack, or phones?

---

## 9. Deliverables status

| Deliverable | Status |
|---|---|
| Single product concept + requirements doc (this file) | ✅ rev 2 |
| Clickable prototype — owner / tenant / operator, tipping toggle | ✅ `valet/index.html` |
| Departure renames + scheduled-only + 2-hr rule | ✅ |
| Arrival flow (schedule + announce, services-before-park) | ✅ |
| Fuel simplified (Jet A / 100LL top-off) | ✅ |
| Tenant persona + in-app sign-up | ✅ |
| Two versions (with / without tip) | ✅ via toggle |
| HTML release-notes page for George | ✅ `valet/release-notes.html` |
| PPTX concept deck for George | ✅ `docs/Jays-Valet-Concept-Deck.pptx` |
| Pushed to GitHub (`h9-jac-mobile-prototype`) | ✅ |
