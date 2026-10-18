# Midas

iOS-only app for DubHacks, Visa track. User snaps a photo of an item, gets a
0-100 value score, and can buy it now or auto-buy at a target price.
Electronics is the demo category. (Formerly "Snap & Score". Rename any
leftover references when you touch those files.)

## Stack
- Platform: iOS only. No Android code, configs, or testing. Ignore Android warnings.
- App: React Native + Expo, run as a development build with expo-dev-client
  (not Expo Go) so native modules work and the project opens in Xcode. Camera: expo-camera.
- Xcode: native project lives in /ios after `npx expo prebuild`. Signing is set
  up by a human in Xcode; agents never change signing, bundle ID, or team settings.
- Testing: see "Dev machines and testing" below.
- Backend: small API server. Holds all API keys, scoring config, and payment calls. Keys never ship in the app.
- DB + auth: Supabase (Auth with email + password, Postgres, Storage). The app reads and writes
  `items` directly with supabase-js, protected by RLS (`user_id = auth.uid()`). The server verifies the
  user's JWT (`server/src/middleware/requireUser.ts`) and uses the service-role key only for automation.
  Call the server through `app/lib/apiFetch.ts` so the access token is attached. Schema: `supabase/migrations/`.
- Image analysis: Gemini API (vision) on the photo, structured JSON output. Owner: Caleb.
- Review analysis: Gemini API (text) on review text for the quality sub-score. Owner: Havel.
  Separate prompt from image analysis; same server-side key. Use `@google/genai`, the same
  model as Caleb's call (currently `gemini-2.5-flash`), `temperature: 0`, and `responseSchema`.
- Listings and reviews: SerpAPI (Google Shopping + `google_immersive_product` detail call) and eBay Browse API.
  Fallback for thin review text: SerpAPI Walmart or Amazon review engines.
- Checkout: Stripe test mode with a fake merchant we add. Saved card, charged off-session with a
  PaymentIntent for buy-at-target.
- Push: Expo Notifications (APNs). Push only works on a real iPhone.

## Dev machines and testing
The team uses both Macs and Windows laptops. Check which OS you are on before
running any app command.

Everyone (Mac or Windows) tests the app on their own iPhone through the dev
client build distributed on TestFlight:
1. Install the Midas build from the TestFlight app.
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
- /ios                native Xcode project (generated; edit through app.json/config plugins when possible)
- /app/screens        signin, camera, item-detail, library, checkout, profile
- /app/components     ScoreCard (swipe + tap), SubscoreRow
- /server/analysis    Gemini vision client (Caleb)
- /server/listings    SerpAPI + eBay clients, normalized output, listing cleaning, best listing, review fetch
- /server/scoring     four sub-scores, quality Gemini text call, weights, verdict, reason strings
- /server/config/weights/   electronics.json, default.json (weights, tuning constants, sale events, trusted retailers)
- /server/data/price-history/   seeded 90-day history, one JSON file per stage item
- /server/checkout    Stripe client, buy-now, buy-at-target automation
- /context            LOCAL ONLY, must be in .gitignore (never commit it). The scoring spec lives here, one
                      file per sub-score: quality-subscore.md, price-subscore.md, reviews-subscore.md, timing-subscore.md

## Scoring spec location
The spec for each rating sub-score is in /context. That folder is local to Havel's machine and is
gitignored, so it will not exist in a fresh clone. Read the matching file before building or changing
a sub-score. Do not commit /context, link to it from code, or treat it as a deliverable.

## Contracts (do not change without telling the owner)

Analysis output (Caleb -> Havel):
```json
{ "category": "", "brand": "", "model": "", "name": "", "summary": "", "confidence": 0.0 }
```

Normalized listing (Havel's listings clients):
```json
{ "source": "serpapi|ebay|sandbox", "merchant": "", "title": "", "price": 0, "shipping": 0, "url": "", "sellerRating": 0, "condition": "new|used|refurbished" }
```
`sellerRating` is 0 to 5 stars, or null when unknown (unknown means no penalty).

Score output (Havel -> everyone):
```json
{
  "score": 0,
  "verdict": "buy_now|wait|skip",
  "subscores": {
    "quality": { "value": 0, "reason": "", "data_quality": "ok|limited" },
    "price":   { "value": 0, "reason": "", "data_quality": "ok|limited" },
    "reviews": { "value": 0, "reason": "", "data_quality": "ok|limited" },
    "timing":  { "value": 0, "reason": "", "data_quality": "ok|limited" }
  },
  "best_listing": { "merchant": "", "price": 0, "shipping": 0, "url": "" },
  "suggested_target_price": null
}
```
- A sub-score that can't be computed is `null` (see "Missing data" below). UI must handle null sub-scores.
- `suggested_target_price` is the 90-day low when the verdict is `wait`, otherwise null.
  The checkout screen prefills `target_price` with it; the user can change it.

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
- Show the real star rating and review count. Never show adjusted ratings or the seller risk penalty.

## Scoring rules

### General
- score = weighted sum of quality, price, reviews, timing; weights per category in /server/config/weights.
- Two axes: the item axis (quality, reviews) and the deal axis (price, timing).
- Every sub-score needs a one-line human reason. No bare numbers in the UI.
- Reason strings are built in code from the same numbers the math used. Gemini never writes a reason;
  the only Gemini text that reaches the UI is the quality `evidence_quote`.
- All tuning constants (multipliers, bounds, windows, penalties) live in
  `/server/config/weights/electronics.json`, not hardcoded in scoring files.
- Never let commission or merchant identity affect the score in production code.
  The trusted retailer list is about reliability only.
- Clamp every sub-score to 0 to 100.

### Missing data
- Fewer listings, reviews, or history than the spec wants: still score, set `data_quality: "limited"`,
  use the limited-data reason string.
- No usable data at all: set that sub-score to null and renormalize weights within its axis
  (quality missing -> reviews carries the item axis, etc.).
- Never block the score card on a slow or failed call. The quality Gemini call failing or timing out
  is treated as no review text.

### Quality (spec: context/quality-subscore.md)
- Pipeline: Shopping search -> pick result with model number in title -> product detail call ->
  Gemini counts failure signals -> code computes score.
- Gemini only counts (`failure_mentions`, `early_failure_mentions`, `durability_praise`,
  `expert_reliability_cons`, `evidence_quote`). It never rates the product.
- Set `reviews_read` in code, not from the model.
- Prioritize 1 to 3 star reviews; target 30 to 80. Under ~15 is limited.
- Cache results by `brand + model`. The stage item must never change score between runs.
- Start the Gemini call in parallel with price and timing as soon as the detail call returns.
- Never claim a lifespan in a reason string.

### Price (spec: context/price-subscore.md)
- Fetch Google Shopping and eBay (new only) in parallel, plus the sandbox listing in demo mode.
- Clean before anything else: drop listings without the model number in the title, non-new, below
  0.5x median, or above 2x median. Under 3 survivors is limited.
- Pick `best_listing` by effective price (price + shipping + seller risk penalty). The penalty is for
  ranking only; the user sees and pays the real price.
- Reference price = median of cleaned price + shipping, excluding `source: "sandbox"`.
- Tax is ignored.
- Used/refurbished are out of the score for the hackathon.

### Reviews (spec: context/reviews-subscore.md)
- Plain math, no Gemini. Uses star average and review count from the Shopping result.
- Bayesian shrink toward `CATEGORY_AVG` using `TRUST_HALFWAY`, then stretch 3.8 to 4.8 stars onto 0 to 100.
- Fake-review penalty only runs if the star breakdown is available.
- Multiple Shopping results for one model: use the one with the most reviews.

### Timing (spec: context/timing-subscore.md)
- Position of today's best price (price + shipping) between the 90-day low and high.
- Flat history scores 50. Below the 90-day low clamps to 100.
- Sale penalty when a configured sale event is within the window and today isn't near the low.
  Only add sale events with confirmed dates.
- Price history is seeded for the demo. Under 14 days is limited; none means timing is null.

## Checkout rules
- Buy now: charge for `best_listing` through Stripe (test mode).
- Buy at best price: save `target_price`, set `checkout_status = "watching"`. When a price check
  finds price <= target, charge the saved card with an off-session PaymentIntent, set "purchased",
  send a push notification with the item and price.

## Demo mode
One flag, `DEMO_MODE`, controls exactly two things and nothing else:
1. Whether the sandbox merchant listing (`source: "sandbox"`) is added to listings.
2. The manual price-drop trigger.

How the demo works:
- The sandbox merchant has a believable store name and starts priced slightly above the best real price,
  so a real store wins and the stage item lands on Wait.
- The price drop lowers the sandbox price below the user's target and below every real store.
  It becomes `best_listing` only by having the lowest price. Scoring code never forces it to win.
- The dropped price is appended to the item's seeded history as today's entry, so reopening the item
  shows timing at its 90-day low.
- Sandbox listings never count toward the price reference median.
- Before demo day, tune seeded history and constants so the stage item is Wait before the drop and
  buy-now territory after it.

## Owners
- Auth, photo library/DB: Stanley
- Camera, image analysis (vision): Caleb
- Rating algorithm, listings, review analysis (text): Havel
- Checkout, automation: Pedro
- UI: everyone owns their own screens

## Out of scope for the hackathon
Android, own-it mode (similar/upgrade items), sell mode, clothes and furniture,
used/refurbished listings in the score, real scheduled price checks, real price history, App Store release.
