# Jay's Ramp Valet — App Store Submission Kit

## App identity
- **Bundle ID:** `com.jaysaircenter.rampvalet`
- **Display name:** Jay's Ramp Valet
- **Category:** Travel (secondary: Business)
- **Privacy policy URL:** https://h9-jac-valet.netlify.app/valet/privacy.html (move to jaysaircenter.com before launch if preferred)
- **Support URL:** https://www.jaysaircenter.com

## One-time setup (requires your Apple account)
1. Enroll: https://developer.apple.com/programs/enroll ($99/yr, 24–48h approval).
2. In Xcode → Settings → Accounts: sign in with the enrolled Apple ID.
3. Open `valet-ios/ios/App/App.xcodeproj`, select the App target → Signing & Capabilities → check "Automatically manage signing" → pick your Team.
4. App Store Connect (https://appstoreconnect.apple.com) → My Apps → "+" → New App → bundle ID `com.jaysaircenter.rampvalet`.

## Ship a TestFlight build
```sh
cd valet-ios && ./build-www.sh && npx cap sync ios
open ios/App/App.xcodeproj
# Xcode: Product → Archive → Distribute App → TestFlight
```
Add George as an internal tester with his Apple ID email.

## Backend env (set before the store build goes live)
```sh
cd jays-air-center-website
npx netlify env:set VALET_SESSION_SECRET "$(openssl rand -hex 32)"   # rotates all sessions
npx netlify env:set VALET_SEED_PASSWORD "<strong password for the 3 seed accounts>"
npx netlify env:set STRIPE_SECRET_KEY "sk_live_..."                  # from dashboard.stripe.com
npx netlify env:set STRIPE_PUBLISHABLE_KEY "pk_live_..."
npx netlify deploy --prod
```

## App Review notes (paste into App Store Connect → App Review Information)
> Jay's Ramp Valet is the tenant-facing service app for Jay's Air Center, an
> FBO (private aviation terminal) at John Wayne Airport (KSNA). Aircraft
> owners who lease parking with us use it to schedule arrivals/departures,
> order fuel, and tip the line crew that physically handles their aircraft.
>
> Demo account (tenant role): tenant@jaysair.test / <VALET_SEED_PASSWORD>
> From the home screen, tap "Schedule Your Arrival", pick a time, and submit —
> a live line-crew queue receives the request.
>
> Tips pay for an in-person physical service performed by our employees on
> the airport ramp, and are processed with Stripe per Guideline 3.1.5(a)
> (physical services consumed outside the app).

## App Privacy (nutrition label answers)
| Data type | Collected? | Linked to user | Tracking |
|---|---|---|---|
| Name, Email | Yes — account | Yes | No |
| Payment info | Yes — handled by Stripe (card never on our servers) | Yes | No |
| Purchase history | Yes — tips/service requests | Yes | No |
| Location | No | — | — |
| Identifiers / advertising data | No | — | — |

Third-party SDK: Stripe (payments). No analytics, no ads.

## Guideline 4.2 (minimum functionality) posture
If the reviewer questions the web-view architecture, the response: this is a
logged-in operational tool for a single FBO's tenants — real accounts, live
dispatch queue, real payments; not a repackaged website (the marketing site
is separate). Native push notifications are on the v1.1 roadmap.

## Screenshots (required sizes)
- 6.9" (iPhone 17 Pro Max): 1320×2868
- 6.5" (older requirement, often optional now): 1284×2778
Generate from the Simulator: `xcrun simctl io booted screenshot shot.png`
Suggested set: tenant home → arrival form → live tracker → lineman queue → owner dashboard.

## Version cadence
- v1.0: this build (login, scheduling, fuel, notes, Stripe tips)
- v1.1: APNs push for the line crew, Stripe Apple Pay button
