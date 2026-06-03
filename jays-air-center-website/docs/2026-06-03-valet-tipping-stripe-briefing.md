# Jay's Valet — Electronic Tipping: What "going live" actually requires

**For:** George · **From:** Jacob · **Date:** 2026-06-03
**Decision needed:** Do we turn on *real* electronic tipping (Version A) for v1, or
ship with the tip screen mocked and decide later?

In the MVP, the tip flow works **end to end in the app** — the customer picks an
amount and sees a confirmation — but **no real money moves yet.** That was
deliberate: real tipping is less a UI feature and more a money-movement product,
and it carries setup, cost, and liability you should weigh before we build it.

---

## What real tipping means technically

Tips go *from a customer* *to an individual line operator*. That makes Jay's a
**marketplace/platform moving money to third parties**, which is exactly what
**Stripe Connect** is for. The pieces:

1. **Each operator becomes a Stripe "connected account."** Before a lineman can
   receive a cent, they complete Stripe onboarding: legal name, SSN/EIN, DOB,
   address, and a **bank account** for payouts. This is **KYC** — legally
   required, not optional.
2. **Customers need a card on file** (Stripe Elements / Apple Pay).
3. **Each tip is a charge** routed to that operator's connected account, with
   Jay's as the platform.
4. **Payouts** land in the operator's bank on Stripe's schedule (typically 2 days).

## The costs

| Item | Cost |
|---|---|
| Stripe processing | **2.9% + $0.30** per tip (a $20 tip nets ~$19.12) |
| Stripe Connect | Platform/active-account fees may apply depending on the Connect type |
| Build effort | ~3–5 extra days: Connect onboarding, card capture, charge + payout logic, an operator "earnings" screen, webhooks for payout status |
| Ongoing | Reconciliation, disputes/refunds, failed-payout handling |

## The liability / admin you're taking on

- **Tax reporting.** Operators receiving money may need **1099-K**s; Stripe helps,
  but Jay's is now in the middle of worker payments. **Loop in your accountant.**
- **Worker classification.** Tips to W-2 employees vs. contractors have different
  treatment. If linemen are Jay's employees, payroll/tip-reporting rules apply and
  routing tips *around* payroll can create problems. **This is the big one — worth
  a quick call with HR/payroll before committing.**
- **"100% goes to the operator" promise.** The app says it; Stripe fees mean the
  operator nets ~96–97% unless Jay's absorbs the fee. Pick one and be consistent.
- **Disputes/chargebacks** on tips, while rare, fall on the platform.

## Three viable paths

| Option | What it is | Effort | Best when |
|---|---|---|---|
| **A. Mocked (today's MVP)** | Tip UI works, no money moves | Done | Validate that customers *want* to tip before building payments |
| **B. Real Stripe Connect** | Full marketplace tipping + payouts | +3–5 days + accountant/HR sign-off | Tipping is a confirmed v1 priority and worker classification is settled |
| **C. Tip added to the FBO invoice** | Tip is a line item on Jay's existing bill; Jay's distributes via payroll | Depends on FBO software | Linemen are W-2 employees — keeps tips inside existing payroll/tax rails |

## My recommendation

**Ship the MVP with tipping mocked (Option A)** and use it to confirm real demand.
In parallel, **answer two questions** that decide B vs C:
1. Are Jay's linemen **employees or contractors**?
2. Does Jay's want tips to flow **through payroll** (Option C, usually cleaner for
   employees) or **directly to the operator** (Option B)?

Once those are answered we can scope the real build in a day. Nothing in the MVP
has to change to add it later — the tip screen and data are already there.

---

### Open question for George (from the concept doc, still open)
> *"Tipping in or out for v1?"* — This briefing is the input to that call.
