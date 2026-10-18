# Midas

**Snap a product. Get a straight answer on whether it's worth buying. Buy it, or let Midas buy it when the price drops.**

Midas is an iOS app built at DubHacks (Visa track). Point the camera at an electronics product and Midas identifies it, scores its value from 0 to 100, and gives one verdict: **Good buy**, **Wait**, or **Skip**. From the same card you can buy it now, or set a target price and have it bought automatically when the price falls to that target.

## How it works

1. **Snap.** The camera opens straight after sign-in, laid out like Apple Camera: Library bottom-left, shutter in the middle, Profile bottom-right.
2. **Identify.** The photo goes to Gemini (vision), which returns the brand, model, name and a short summary. If the exact model can't be read, the app asks for a retake instead of guessing.
3. **Score.** The server looks up current listings and reviews and builds four sub-scores. Each one comes with a one-line reason; the app never shows a bare number.

   | Sub-score | Weight | What it measures |
   |---|---|---|
   | Quality | 25% | How often owners report failures, from review text Gemini counts (it never rates the product itself) |
   | Reviews | 20% | Star rating and review count, pulled toward the category average when there are few reviews |
   | Price | 30% | Today's best new price against the typical price across cleaned listings |
   | Timing | 25% | Where today's price sits in its 90-day range, and whether a known sale is coming |

   The overall score is the weighted sum (weights live in `server/config/weights/electronics.json`). A thin or missing sub-score lowers its weight instead of guessing. The merchant or any commission never affects the score.
4. **Decide.** A score card appears over the photo:
   - **Swipe left** to save it to your Library, **swipe right** to delete it (deleted snaps are never stored). Both have a 5-second Undo.
   - **Show breakdown** expands the four sub-scores on the card; tap the card for full detail.
   - **Checkout** saves the item and opens checkout: buy now, or set a target price for auto-buy.
5. **Library.** Saved items are grouped into Watching, Saved and Purchased, and update live, so an auto-buy shows up the moment it happens.

Profile shows your account, your item counts, and a Dark Mode switch.

## Tech stack

| Layer | Technology |
|---|---|
| iOS app | React Native + Expo (development build with `expo-dev-client`), TypeScript |
| Auth and data | Supabase: email/password auth, Postgres with row-level security, Storage for thumbnails, Realtime for live updates |
| API server | Node.js 22 + Express, TypeScript |
| Identification | Gemini API (vision, structured JSON output) |
| Listings and reviews | SerpAPI (Google Shopping, product detail, Walmart reviews) |
| Checkout | Stripe (test mode only) with a sandbox merchant |

## Architecture

```
iPhone app ──(Supabase JWT)──▶ API server ──▶ Gemini (identify, review signals)
    │                               ├──────▶ SerpAPI (listings, reviews)
    │                               ├──────▶ Stripe test mode (payments, saved card)
    │                               └──────▶ Supabase (service role: checkout, automation)
    └──(supabase-js, RLS)──▶ Supabase (items, thumbnails, realtime)
```

- **The app talks to Supabase directly for its own library.** Each user can only read and write their own items (`user_id = auth.uid()`). Thumbnails are resized to 400px before upload.
- **Everything that needs a secret goes through the server**: identification, scoring, payments and automation. API keys never ship in the app; only `EXPO_PUBLIC_*` values do.
- **The server verifies the user's Supabase token** on every request (`server/src/middleware/requireUser.ts`). The app calls it through `app/lib/apiFetch.ts`, which attaches the token.
- **Checkout is server-controlled.** The app can't change payment fields itself (a database trigger blocks it); purchases, watches and offers go through the server.

## Repository layout

```
App.tsx                 Screen switching (camera → library → item → checkout) and providers
app/
  screens/              SignIn, Camera, Library, ItemDetail, Checkout, Profile
  components/           ScoreCard (swipe, scroll, breakdown), UndoBar
  features/             auth (session), library (Supabase api, live hooks, save + undo)
  lib/                  apiFetch, theme (light/dark palettes), scoring and demo clients
server/
  src/analysis/         Gemini vision identification
  src/listings/         SerpAPI client, listing cleaning, caching
  src/scoring/          Sub-scores, composer, verdict, demo store and price drop
  src/checkout/         Stripe gateway, buy now, buy-at-target watcher
  src/routes/           /analyze, /score, /checkout/*, /demo/*, /webhooks/stripe
  config/weights/       Weights and tuning constants per category
  data/price-history/   Seeded 90-day price history for demo items
  tests/                Node test runner suites
supabase/migrations/    items, thumbnails storage, sandbox checkout tables and functions
shared/                 Contracts shared by the app and server
```

## Getting started

**Requirements:** Node.js 22+, a Supabase project, and API keys for Gemini, SerpAPI and Stripe (test mode). The app runs as an iOS development build; Expo Go does not work with this project.

1. **Install**

   ```sh
   npm install
   cd server && npm install && cd ..
   ```

2. **Configure.** Copy `.env.example` to `.env` at the repo root and fill it in. The server and the app both read this file.

   | Variable | Used by | Purpose |
   |---|---|---|
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | server | Verify user tokens |
   | `SUPABASE_SERVICE_ROLE_KEY` | server | Checkout and automation (never expose to the app) |
   | `GEMINI_API_KEY` | server | Identification and review analysis |
   | `SERPAPI_KEY` | server | Listings and reviews |
   | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | server | Test-mode checkout |
   | `DEMO_MODE` | server | Adds the sandbox store and the manual price drop |
   | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | app | Sign-in and library |
   | `EXPO_PUBLIC_API_URL` | app | The server's address (must be reachable from the phone) |

3. **Database.** Apply the SQL files in `supabase/migrations/` in order.

4. **Run the server**

   ```sh
   cd server
   npm run dev          # http://localhost:4000, check with GET /health
   ```

   On a phone, `localhost` means the phone itself. Point `EXPO_PUBLIC_API_URL` at a hosted server (we use Render) or an HTTPS tunnel to port 4000.

5. **Run the app.** Install the Midas development build on your iPhone (TestFlight), then:

   ```sh
   npx expo start --dev-client --tunnel
   ```

   Open the app on the phone; it connects to your dev server and reloads on save. JavaScript changes never need a new build; adding native packages or changing `app.json` does.

## Testing

```sh
npm run typecheck              # app
cd server && npm test          # server: routes, scoring, checkout, demo
cd server && npm run try:score # terminal checks of the scoring pipeline (see server/scripts)
```

## Demo mode

With `DEMO_MODE=true`, the server adds a sandbox store to the listings so the full flow can be shown live without real merchants:

- The featured demo product (AirPods Max, set in `server/config/weights/electronics.json`) is offered by the sandbox store, so it can be bought straight from the card.
- For other items a real store keeps the best price and the item lands on **Wait**. Set a target price; a manual price drop then lowers the sandbox price below it and the auto-buy fires.
- Payments use Stripe test cards only (for example `4242 4242 4242 4242`). No real money moves.

Demo mode only controls the sandbox listing and the price drop; it never changes how scores are calculated.

## Team

| Area | Owner |
|---|---|
| Auth, photo library and database, app screens | Stanley |
| Camera and image analysis | Caleb |
| Rating algorithm, listings and review analysis | Havel |
| Checkout and automation | Pedro |

Built in a weekend for DubHacks.
