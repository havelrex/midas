# Snap & Score

**Snap a photo of a product and get one score with a clear verdict: _Buy now_, _Wait_, _Skip_, or _Sell for $X_.**

Google Lens turns a photo into a list of shopping results and leaves the decision to you. **Snap & Score** makes the decision: our rating algorithm grades every option on **quality**, **reviews**, **price**, and **deal timing**, then tells you what to do.

---

## Core User Flows

The app opens straight to the camera. Both modes share the same first three steps:

1. **Snap a photo** with the in-app camera.
2. **Identify** the product with the Gemini Vision API (`category`, `brand`, `model`, `confidence`).
3. **Confirm or correct** the identification so pricing and scoring are grounded on the exact item.

Then the flow splits:

- **Want it (Buy Mode):** Pulls listings from Google Shopping (SerpAPI) and eBay, finds the best price from a trusted seller, displays the `0–100` score with a breakdown and alternative prices one tap away, and lets you set a **price alert** via push notification.
- **Own it (Sell Mode):** Pulls eBay sold prices and returns **"Sell for $X on eBay."**

---

## Starting Categories

| Category | Status | Why it fits | Main risk |
| :--- | :--- | :--- | :--- |
| **Electronics** | Lead (stage demo) | Model numbers and clear branding make exact matches reliable; deep price history; predictable deal timing (Black Friday, launch cycles) | Variant matching (storage size, model year) and refurbished vs. new |
| **Clothes** | Second flow | Large secondhand market makes sell mode strong (eBay, Poshmark, Depop sold listings) | Unbranded basics, colorways, and sizes; relies more on a "similar items" fallback |

---

## Rating Algorithm

Every result gets a `0–100` score built from four sub-scores, each shown with a one-line reason:

```text
score = w_q * quality + w_r * reviews + w_p * price + w_t * timing
```

| Sub-score | What it measures | How we compute it |
| :--- | :--- | :--- |
| **Quality** (`w_q`) | Will it hold up at month six? | LLM mines review text for durability signals (*"broke after 3 months"*); expert reviews when available |
| **Reviews** (`w_r`) | How trustworthy is the rating? | Bayesian average (low-count products regress to category mean); discounts fake-review patterns; weights recent reviews higher |
| **Price** (`w_p`) | How good is this price vs. everyone else? | Percentile across all sellers after shipping and tax, adjusted for seller reliability and condition |
| **Timing** (`w_t`) | Is now the moment to buy? | Current price vs. 90-day average using price history (Keepa for Amazon, internal logs elsewhere) |

**Category Weights:** Weights live in a per-category config with a generic default:
- **Electronics:** Weights timing and price heavily.
- **Clothes:** Weights quality and condition higher.
- **Furniture *(post-MVP)*:** Weights quality and condition highest.

**Verdicts:** `Buy now`, `Wait` (price likely to drop), `Skip` (better option exists), and in sell mode, `Sell for $X on <platform>`.

### Example Output

> **84 / 100: Buy now**
> - **Price:** Excellent (22% below its 90-day average)
> - **Quality:** Good (few durability complaints)
> - **Reviews:** Very good (4.6 across 11k reviews, low fake-review risk)

---

## Tech Stack & Data Sources

| Layer | Choice | Notes |
| :--- | :--- | :--- |
| **App** | React Native + Expo | `expo-camera` for capture; Expo Go for demo, dev build later |
| **Push** | Expo Notifications | Price alerts once scheduled checks exist |
| **Identification** | Gemini API (Vision) | Structured output: `category`, `brand`, `model`, `confidence` |
| **Buy Listings** | SerpAPI (Google Shopping) | Covers electronics and clothes well |
| **Buy + Sell Data** | eBay Browse API | Sold/completed prices power sell mode |
| **Price History** | Keepa API + internal logs | Start logging prices from launch |
| **Backend** | Node.js / TypeScript API Server | Holds per-category weight config; keeps API keys off the phone |
| **Storage** | Hosted DB (Supabase / Firebase) | Users, alerts, and price logs |

---

## Hackathon MVP Scope

### In Scope
- [ ] Mobile app running on a physical phone via Expo Go / dev build
- [ ] Photo capture -> Gemini structured identification -> User confirm/correct screen
- [ ] Listings pulled from Google Shopping (SerpAPI) and eBay
- [ ] Full `0–100` score with sub-score breakdown and verdict
- [ ] Sell mode: eBay sold-price range and suggested listing price
- [ ] Price alert: user sets a target price and we store it
- [ ] Clothes flow working as a second example (with "similar items" fallback)

### Out of Scope (Post-Hackathon)
- Furniture category
- Personalization ML (adjusting weights per user)
- Live scheduled price checks & automated push alerts
- App Store and Play Store release
- Facebook Marketplace and OfferUp integrations

---

## Build Plan

1. **App shell:** Expo project, camera screen, results screen, basic auth
2. **Identification:** Gemini prompt with structured output and confirm/correct screen (tuned on electronics first)
3. **Listings engine:** SerpAPI and eBay calls normalized into one listing format
4. **Scoring:** Four sub-scores, category weight config, verdict logic, breakdown UI
5. **Sell mode:** eBay sold-price range and suggested listing price
6. **Price alerts:** Save a target price per product
7. **Clothes flow:** Clothes weight config and "similar items" fallback
8. **Demo polish:** Seeded price history and stage item testing

---

## License

[MIT](./LICENSE) © Havel Konda
