# Jay's Valet — Aircraft Staging App
### Product Concept & Requirements (single source of truth)

**Owner:** Jacob Hernandez · **Stakeholder:** George · **Client:** Jay's Air Center (FBO, John Wayne Airport / KSNA)
**Status:** Concept + clickable prototype · **Last updated:** 2026-06-01

---

## 1. The one-liner

> **"Summon your plane like a Tesla."** An owner taps once, the ground crew pulls the
> aircraft from the hangar, fuels and stages it on the ramp, and the owner gets a
> push notification the moment it's ready to fly.

Inspired by the **Tesla app ("Summon")** and **robotaxi** flows: one tap, live status,
arrives ready. We are digitizing the phone call that owners make today to Jay's line crew.

---

## 2. Why this exists

Today an owner calls the FBO front desk and says "pull 5-niner-Charlie out, top off
the Jet A, I'm leaving at 9." That request is verbal, untracked, and the owner has no
visibility into whether it's done until they walk out to the ramp. The valet app:

- **Removes the phone call** — request from the app, anytime.
- **Gives the owner live status** — Requested → Crew assigned → Towing → Fueling → **Staged & ready**.
- **Notifies on ready** — push notification with the ramp spot ("Staged at Row B, Spot 14").
- **Lets owners thank the crew** — optional electronic tip (Version A only).

For Jay's this is a premium-service differentiator and a new touchpoint with every based
and transient aircraft owner.

---

## 3. Personas

| Persona | Who | Primary job in the app |
|---|---|---|
| **Owner / Pilot** | Based or transient aircraft owner | Summon / schedule staging, watch status, (tip) |
| **Line Crew / Lineman** | Jay's ground staff | See the request queue, update status, mark staged |
| **Front Desk / CSR** *(future)* | Jay's customer service | Oversee all requests, reassign, handle billing |

The prototype focuses on the **Owner** experience, with a **light Crew view** to show
the other side of the same request.

---

## 4. Core flow (the happy path)

```
OWNER                         CREW                          OWNER
─────                         ────                          ─────
Open app                                                    
Select aircraft                                             
Tap "Stage Aircraft"  ──────► Request lands in queue        
Pick now / schedule           Lineman accepts               
Add fuel + services   ──────► Crew assigned        ───────► "Crew assigned" push
Confirm                       Tow from hangar      ───────► "Towing to ramp" push
                              Fuel + position      ───────► "Fueling" push
                              Mark STAGED & READY  ───────► "✈ Staged & ready" push
(Version A) Leave a tip                                     
Done                                                        
```

Return leg ("put it away" / tow back to hangar) is the same flow in reverse and is
in scope for the prototype as a secondary action.

---

## 5. Feature scope

### MVP (in the prototype)
- **Aircraft profile** — tail number, type, home hangar/row.
- **Summon / Stage** — "Stage now" or "Schedule for a departure time."
- **Fuel request** — Jet A / 100LL, top-off or set quantity.
- **Services** — lav, potable water, GPU/ground power, de-ice, rental car, catering.
- **Live status tracker** — 5-step progress with crew name + ETA + ramp spot.
- **Push notifications** — one per status change (simulated in prototype).
- **Stage / Return toggle** — request out to ramp, or back to hangar.
- **History** — past staging requests.
- **Electronic tip** *(Version A only)* — preset amounts + custom + note to crew.
- **Crew view (light)** — incoming queue, accept, advance status.

### Post-MVP / roadmap
- Real auth (Supabase) + per-owner aircraft list.
- Real push (APNs) and SMS fallback.
- Payment rails for fuel/services + tip payout to crew (Stripe).
- Billing integration with Jay's existing FBO software.
- Multi-aircraft / flight-department accounts.
- Crew scheduling, load balancing, and SLA timers.
- Apple Wallet ramp pass; live ramp map.

---

## 6. The two versions (required deliverable)

We are shipping **two variants of the same app** so Jay's / George can compare:

| | **Version A — Concierge** | **Version B — Standard** |
|---|---|---|
| Core staging flow | ✅ identical | ✅ identical |
| Notifications | ✅ | ✅ |
| **Electronic tipping** | ✅ tip screen after "Staged & ready" | ❌ none |
| Closing screen | Tip → thank-you | Rating / thank-you only |
| Best when | Crew tips are a wanted perk; positions the service as concierge | Tipping is awkward for the customer base or handled off-app |

In the prototype, a single **"Tipping" toggle** flips the build between A and B live, so
they can be demoed side by side without two separate apps.

---

## 7. Key decisions (log)

- **2026-06-01** — Model the core interaction on **Tesla Summon** (one tap, live status,
  arrives ready) rather than a generic "service request form."
- **2026-06-01** — Ship **one prototype with a tipping toggle**, not two codebases, so the
  with/without-tip decision can be made from one demo.
- **2026-06-01** — **Simplicity first.** MVP is the staging happy path; payments, real auth,
  and billing integration are explicitly roadmap, not prototype.
- **2026-06-01** — Match **Jay's Air Center brand** (Cormorant / DM Sans, deep-navy +
  burnished-gold) so the app reads as a Jay's product, not a generic SaaS tool.
- **2026-06-01** — Prototype lives inside the website project so George gets a single
  clickable link; release-notes page will point to it.

## 8. Open questions for George

1. Tipping in or out for v1? (Drives A vs B.)
2. Who are the first users — based aircraft only, or transient too?
3. Does Jay's want fuel/services *billed* through the app, or just *requested*?
4. Is there existing FBO software we must integrate with for billing/aircraft data?
5. Crew side — dedicated tablet at the line shack, or phones?

---

## 9. Deliverables status

| Deliverable | Status |
|---|---|
| Single product concept + requirements doc (this file) | ✅ |
| Clickable prototype — Owner + Crew, with tipping toggle | ✅ `valet/index.html` |
| Two versions (with / without tip) | ✅ via toggle |
| HTML release-notes page for George (scope, roadmap, decisions, app link) | ⏳ next |
