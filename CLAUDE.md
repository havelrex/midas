# Snap & Score

iOS-only app for DubHacks, Visa track. User snaps a photo of an
item, gets a 0-100 value score, and can buy it now or auto-buy at a target
price through Visa Intelligent Commerce. Electronics is the demo category.

## Stack
- Platform: iOS only. No Android code, configs, or testing. Ignore Android warnings.
- App: React Native + Expo, run as a development build with expo-dev-client
  (not Expo Go) so native modules work and the project opens in Xcode. Camera: expo-camera.
- Xcode: native project lives in /ios after `npx expo prebuild`. Signing is set
  up by a human in Xcode; agents never change signing, bundle ID, or team settings.
- Testing: see "Dev machines and testing" below.
- Backend: small API server. Holds all API keys, scoring config, and Visa calls. Keys never ship in the app.
- DB + auth: Supabase (Auth with email + password, Postgres, Storage). The app reads and writes
  `items` directly with supabase-js, protected by RLS (`user_id = auth.uid()`). The server verifies the
  user's JWT (`server/src/middleware/requireUser.ts`) and uses the service-role key only for automation.
  Call the server through `app/lib/apiFetch.ts` so the access token is attached. Schema: `supabase/migrations/`.
- Image analysis: Gemini API (vision), structured JSON output.
- Listings: SerpAPI (Google Shopping) + eBay Browse API.
- Checkout: Visa Intelligent Commerce, sandbox only, with a fake merchant we add.
- Push: Expo Notifications (APNs). Push only works on a real iPhone.

## Dev machines and testing
The team uses both Macs and Windows laptops. Check which OS you are on before
running any app command.

Everyone (Mac or Windows) tests the app on their own iPhone through the dev
client build distributed on TestFlight:
1. Install the Snap & Score build from the TestFlight app.
2. Run `npx expo start --dev-client --tunnel` on your laptop.
3. Open the app on your iPhone; it connects to your dev server and reloads on save.

`--tunnel` is the default because venue Wi-Fi often blocks phone-to-laptop
connections. Drop it only on a network you know works.

Havel's Mac is the only build machine. Only Havel runs prebuild, pod install,
Xcode archives, and TestFlight uploads.

A new TestFlight build is needed ONLY when native code changes: adding or
upgrading a package with native code, or changing permissions, app.json, or
config plugins. JS and UI changes never need a new build.

Rules for agents:
- On Windows, never run `expo run:ios`, `expo prebuild`, `pod install`, or any
  Xcode command. They cannot work there. Do not try to fix those errors.
- Never add a package with native code on your own. Stop and tell the human,
  who must check with Havel because it requires a new TestFlight build.
- The iOS Simulator (Mac only) has no camera. Camera, snap-to-score, and push
  notifications are tested on a real iPhone only.

## Commands
<!-- Fill in once the repo exists -->
Any OS:
- Dev server for the TestFlight build: `npx expo start --dev-client --tunnel`
- Server: `npm run dev` (in /server)
- Tests: `npm test`

Mac only (Havel's build machine):
- Regenerate native project: `npx expo prebuild --platform ios`
- Run on Simulator: `npx expo run:ios`
- Run on connected iPhone: `npx expo run:ios --device`
- Pods (if a build fails on dependencies): `cd ios && pod install`
- TestFlight: archive in Xcode (Product > Archive), upload, add to the internal testing group

## Layout
<!-- Adjust to the real repo -->
- /ios                native Xcode project (generated; edit through app.json/config plugins when possible)
- /app/screens        signin, camera, item-detail, library, checkout, profile
- /app/components     ScoreCard (swipe + tap), SubscoreRow
- /server/analysis    Gemini client
- /server/listings    SerpAPI + eBay clients, normalized output
- /server/scoring     sub-scores, weights, verdict
- /server/config/weights/   electronics.json, default.json
- /server/checkout    Visa client, buy-now, buy-at-target automation

## Contracts (do not change without telling the owner)

Analysis output (Caleb -> Havel):
```json
{ "category": "", "brand": "", "model": "", "name": "", "summary": "", "confidence": 0.0 }
```

Normalized listing (Havel's listings clients):
```json
{ "source": "serpapi|ebay|sandbox", "merchant": "", "title": "", "price": 0, "shipping": 0, "url": "", "sellerRating": 0, "condition": "new|used|refurbished" }
```

Score output (Havel -> everyone):
```json
{
  "score": 0,
  "verdict": "buy_now|wait|skip",
  "subscores": {
    "quality": { "value": 0, "reason": "" },
    "price":   { "value": 0, "reason": "" },
    "reviews": { "value": 0, "reason": "" },
    "timing":  { "value": 0, "reason": "" }
  },
  "best_listing": { "merchant": "", "price": 0, "shipping": 0, "url": "" }
}
```

Library item (Stanley -> everyone), one row per saved item:
`id, user_id, created_at, thumbnail_url, name, summary, category, brand, model,
score, subscores, verdict, best_listing, target_price (nullable),
checkout_status ("none" | "watching" | "purchased")`

## UI rules
- After sign in, the app opens straight to the camera. Layout mirrors Apple Camera.
- Bottom left: library. Bottom right (where flip-camera usually is): profile. Bottom center: shutter.
- After a snap, a score card appears in the center.
  - Swipe left/down = save to library (toward the library button).
  - Swipe right/up = delete, back to camera. Deleted items are never written to the DB.
  - Tap = expand to full item detail with sub-score reasons and checkout.
- No confirm/correct step for identification. Wrong ID = user deletes and retakes.

## Scoring rules
- score = weighted sum of quality, price, reviews, timing; weights per category in /server/config/weights.
- Every sub-score needs a one-line human reason. No bare numbers in the UI.
- Price history is seeded for the demo.
- Never let commission or merchant identity affect the score in production code.

## Checkout rules
- Buy now: purchase best_listing through Visa Intelligent Commerce.
- Buy at best price: save target_price, set checkout_status = "watching". When a price check
  finds price <= target, purchase, set "purchased", send a push notification.
- Demo only: the sandbox merchant is forced to win and the price drop is triggered manually.
  Keep this behind a clearly named demo flag (e.g. DEMO_FORCE_MERCHANT) so it never leaks into scoring.

## Owners
- Auth, photo library/DB: Stanley
- Camera, image analysis: Caleb
- Rating algorithm, listings: Havel
- Checkout, automation: Pedro
- UI: everyone owns their own screens

## Out of scope for the hackathon
Android, own-it mode (similar/upgrade items), sell mode, clothes and furniture,
real scheduled price checks, App Store release.
