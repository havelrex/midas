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
- Listings and reviews: SerpAPI (Google Shopping + `google_immersive_product` detail call). Search brand + model +
  category (e.g. "Sony WH-1000XM5 Headphones"); brand + model alone returns junk marketplace results.
  eBay Browse API is deferred (access takes a business day), so SerpAPI is the only listings source for now.
  Fallback for thin review text: SerpAPI Walmart or Amazon review engines (not built yet).
  The detail call returns about 6 owner reviews and the star breakdown, but no expert snippets.
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
- /server/src/analysis    Gemini vision client (Caleb)
- /server/src/listings    SerpAPI client (eBay deferred), normalized output, listing cleaning, disk-cached wrapper
- /server/src/scoring     four sub-scores, quality Gemini text call, composer, demo sandbox, orchestrator, reason strings
- /server/src/routes      /analyze, /score, /demo/price-drop (DEMO_MODE only)
- /server/config/weights/   electronics.json, default.json (weights, tuning constants, sale events, trusted retailers)
- /server/data/price-history/   seeded 90-day history, one JSON file per stage item
- /server/data/cache/   scan cache (gitignored)
- /server/scripts     `npm run try:*` terminal checks for each sub-score and the demo story
- /server/src/checkout    Stripe client, buy-now, buy-at-target automation (Pedro, not built yet)
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
- `best_listing` is null when no store sells the item new. The card then says so and blocks saving, because
  `items.best_listing` is NOT NULL. A null listing must never reach the database.
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

### Missing and thin data
- Fewer listings, reviews, or history than the spec wants: still score, set `data_quality: "limited"`,
  use the limited-data reason string. `limited` is a label; it does not change weights by itself.
- Thin data is handled continuously, never with a hard cutoff, and differently per sub-score:
  - Reviews: the Bayesian shrink already covers it. Do not downweight it again.
  - Quality: shrink the failure and praise rates toward category priors with `n / (n + trust_halfway)`.
    Weight stays fixed. Expert cons are a count, not a rate, so they are not shrunk.
  - Price and timing: reduce the weight. Shrinking toward 50 would claim "normal price", which we don't know.
    `confidence.price = min(1, cleanedListings / price_full_trust_listings)`,
    `confidence.timing = min(1, historyDays / timing_full_trust_days)`.
    Within an axis each sub-score's share is base weight x confidence, so a thin price lets timing carry more.
    The axis keeps its full weight if any member has confidence 1, and shrinks with its best member's
    confidence otherwise (both deal sub-scores thin means the item axis counts for more). If a whole axis
    has confidence 0, renormalize across the remaining sub-scores.
- No usable data at all: set that sub-score to null. This is confidence 0, so the same renormalization
  applies (quality missing -> reviews carries the item axis, etc.).
- Verdict cap: `buy_now` claims the price is at or near its low, so it never fires when price or timing
  confidence is below `verdict.buy_now_min_confidence`. Fall back to `wait` and mark the result limited.
- Confidence thresholds, quality priors, and the verdict floor live in `electronics.json`, with the other
  tuning constants.
- Never block the score card on a slow or failed call. The quality Gemini call failing or timing out
  is treated as no review text.

### Quality (spec: context/quality-subscore.md)
- Pipeline: Shopping search -> pick result with model number in title -> product detail call ->
  Gemini counts failure signals -> code computes score.
- Gemini only counts (`failure_mentions`, `early_failure_mentions`, `durability_praise`,
  `expert_reliability_cons`, `evidence_quote`). It never rates the product.
- Set `reviews_read` in code, not from the model.
- Prioritize 1 to 3 star reviews; target 30 to 80. Under ~15 is limited. The detail call only returns about
  6 reviews, so most items will be limited until a second review source is added.
- That sample is skewed toward failures, so rescale the failure rate by (real 1-3 star share / sample 1-3 star
  share) and the praise rate by the matching 4-5 star shares, using the star breakdown, before shrinking.
  Both shares are set in code. Skip the rescale when the breakdown is missing.
- Shrink failure and praise rates toward category priors by `n / (n + trust_halfway)` before scoring, so
  thin review data lands near a typical score instead of a random extreme.
- Cache results by `brand + model`. The stage item must never change score between runs.
- The cache is on disk (`server/data/cache/`, gitignored), so it survives restarts. It holds the SerpAPI search,
  the detail call, and the quality result. Keys ignore case, spacing, and punctuation, so `WH-1000XM5` and
  `WH1000XM5` share one entry. Entries last `SCORE_CACHE_TTL_MINUTES` (default 60); raise it and scan the item
  once before a demo to freeze it. `npm run cache:clear` (in /server) empties it. Failures are never cached.
  This is a normal cache, not a demo path: `DEMO_MODE` still controls only the sandbox listing and the price drop.
- Start the Gemini call in parallel with price and timing as soon as the detail call returns.
- Never claim a lifespan in a reason string.

### Price (spec: context/price-subscore.md)
- Fetch Google Shopping, plus the sandbox listing in demo mode. Used items are detected from SerpAPI's
  `second_hand_condition`. Delivery text sets shipping; unknown shipping counts as free.
- Clean before anything else: drop listings without the model number in the title, non-new, below
  0.7x median, or above 2x median. Under 3 survivors is limited. The low bound was 0.5x, but a live run let a
  $150 scam site through against a $296 median, so it was raised to 0.7x. The sandbox listing is exempt from
  these bounds because it is our own controlled listing.
- Pick `best_listing` by effective price (price + shipping + seller risk penalty). The penalty is for
  ranking only; the user sees and pays the real price.
- Only a vouched-for seller can be `best_listing`: a trusted retailer (exact name match, so third-party
  sellers on a marketplace do not inherit trust) or a known rating of 4 stars or more. Unknown merchants
  still count toward the median. The sandbox store is always eligible but wins only by being cheapest.
  If no seller is vouched for, fall back to the cheapest overall, set `data_quality: "limited"`, and cap
  price confidence at 0.5 so `buy_now` cannot fire. Demo mode only adds the sandbox store next to a
  vouched-for real store.
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
One flag, `DEMO_MODE`, controls the demo-only behavior and nothing in normal scoring:
1. Whether the sandbox merchant listing (`source: "sandbox"`) is added to listings.
2. The manual price-drop trigger (`POST /demo/offer` and `POST /demo/price-drop`).
3. Checkout's operator-only commands (`npm run checkout:demo -- offer|price|demo`).

How the demo works:
- The sandbox merchant is the same store as checkout's (`MERCHANT` in `server/src/checkout/model.ts`, currently
  "Cedar Electronics"), so the card's best listing and the checkout quote name one store. It starts priced slightly
  above the best real price, so a real store wins and the stage item lands on Wait. It is only added next to a
  trusted real store.
- The price drop lowers the sandbox price below the user's target and below every real store.
  It becomes `best_listing` only by having the lowest price. Scoring code never forces it to win.
- The dropped price is appended to the item's history as today's entry, so reopening the item shows timing at
  its 90-day low. Drops are written to a gitignored overlay (`server/data/cache/price-history/`), never into the
  committed seed; `npm run cache:clear` resets them.
- One action does it all. `POST /demo/price-drop {item_id}` computes the price (below the watch threshold and every
  real store), writes it to the item's checkout offer (which the watcher polls to charge the card), appends the
  history, and re-scores and updates the saved item row so the library and detail screen update live.
  `POST /demo/offer {item_id}` first creates the offer at the pre-drop price so checkout is eligible. Without
  `item_id`, the drop only changes scoring (terminal checks).
- On stage the operator uses a hidden control: with `EXPO_PUBLIC_DEMO_TOOLS=true` (app) and `DEMO_MODE=true`
  (server), long-press the verdict line on a saved item's detail screen to "Create sandbox offer" (before setting
  the watch) or "Drop the price". It calls the routes through `apiFetch`, so it uses the user's own login.
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
