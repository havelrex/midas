# Midas sandbox checkout

Backend-only Buy Now and one-shot threshold autobuy for **Cedar Electronics**, a
fake retailer represented by one Stripe sandbox account. No retailer credentials,
Connect accounts, real purchases, shipment, or fulfillment are involved.

## Enable the backend

1. Apply `supabase/migrations/0003_sandbox_checkout.sql` in your Supabase project's
   SQL editor, after the existing `0001` and `0002` migrations. This adds tables,
   transactional RPCs, and guards on the existing library payment fields.
2. Select/create the team's Stripe **sandbox** and use keys from that same sandbox.
   Set its display/business name to Cedar Electronics for a consistent demo.
   No Stripe Products or Prices are needed: prices live in Supabase and the backend
   creates PaymentIntents for the exact USD total.
3. Configure the repository-root `.env` (do not commit it):

   ```dotenv
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   SUPABASE_SERVICE_ROLE_KEY=...
   CHECKOUT_WATCHER_ENABLED=true
   DEMO_MODE=true
   ```

   `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is also accepted as a fallback for the
   publishable key, so the existing Expo setting can be reused. Secret/service-role
   keys must never have an `EXPO_PUBLIC_` prefix. Live Stripe keys are rejected.
   Incomplete payment configuration disables checkout with `503`; `/health`,
   authentication, and analysis still work. All payment keys must belong to the
   same sandbox. `DEMO_MODE` enables manual fixture/price changes, not payment
   authorization. The watcher has its own enable flag and polls every 10 seconds.
4. Forward sandbox webhook events using Stripe CLI, authenticated to that sandbox:

   ```sh
   stripe listen --events setup_intent.succeeded,payment_intent.succeeded,payment_intent.payment_failed,payment_intent.requires_action,payment_intent.processing,payment_intent.canceled --forward-to localhost:4000/webhooks/stripe
   ```

   Copy **this listener's** `whsec_...` into `.env`. A dashboard endpoint's signing
   secret is different. Restart the server after changing environment variables.
5. From `server/`, run `npm install` then `npm run dev`. Keep it running during the
   demo. The Expo/Metro tunnel does not expose this API: the eventual iPhone UI
   needs its own reachable backend URL.

For a deployed test server, register its HTTPS `/webhooks/stripe` URL in the same
sandbox instead of using CLI forwarding. The SDK is locked to Stripe 23.0.0,
whose API version is `2026-09-30.endive`; use that version for the webhook endpoint.
The handler verifies raw-body signatures and retrieves current intent state so
old or duplicate events cannot undo successful purchases.

## Demonstrate both paths without the mobile UI

Use an existing **test** Supabase user's UUID. The command below creates two new
library fixtures belonging to that user, sets up a Stripe test Visa, completes
one Buy Now purchase, and activates an independent watch. It does not log client
secrets or handle card numbers. Run it once per demonstration; repeated runs
intentionally create new fixture items.

```sh
# In server/, with the API and webhook listener running in other terminals:
npm run checkout:demo -- demo USER_UUID
```

The command prints a successful $154 Buy Now order and an autobuy item ID. The
watched offer starts at $259 + $5 shipping, above its $200 threshold. Verify that
the watcher leaves it unpurchased, then lower **the item price**:

```sh
npm run checkout:demo -- status WATCH_ITEM_UUID
npm run checkout:demo -- price WATCH_ITEM_UUID 18000
```

The price command only writes the offer. A subsequent watcher pass claims it and
charges **$185** ($180 + $5 shipping), not the $200 threshold. Inspect the result:

```sh
npm run checkout:demo -- status WATCH_ITEM_UUID
```

Expect `watch.state: "purchased"`, `order.status: "succeeded"`, and
`order.paidAmountCents: 18500`. Confirm the matching test payment in Stripe's
sandbox dashboard. Repeated polls must not create another payment. Library
`checkout_status` changes propagate through the existing Supabase Realtime setup.

To attach a fake offer to an existing test library item without running the full
demo, use `offer ITEM_UUID PRICE_CENTS SHIPPING_CENTS`. This explicitly registers
a **sandbox** offer; it never authorizes paying the real store in `best_listing`.
For example:

```sh
npm run checkout:demo -- offer ITEM_UUID 25900 500
```

## API contract for the UI owner

Use `apiFetch` so the Supabase bearer token is attached. Public types are exported
from `shared/checkout.ts`. Amounts are integer USD cents, minimum 50, maximum
99999999, quantity one. Shipping is included in the charge and threshold. Tax and
scoring penalties are excluded.

| Method and path | Input / response |
| --- | --- |
| `GET /checkout/config` | Sandbox indicator, currency, exact consent text and version. |
| `GET /checkout/items/:itemId` | Eligibility, current fake-retailer quote/revision, watch state, latest purchase. |
| `POST /checkout/items/:itemId/payment-intent` | `{requestId: UUID, offerRevision: number}` → PaymentSheet configuration plus order. |
| `POST /checkout/setup-intent` | `{requestId: UUID, consentVersion: "sandbox-autobuy-v1"}` → setup PaymentSheet configuration and `setupIntentId`. |
| `PUT /checkout/items/:itemId/autobuy` | `{setupIntentId, thresholdCents, consentVersion: "sandbox-autobuy-v1"}` → watch summary. |
| `DELETE /checkout/items/:itemId/autobuy` | Cancel before payment has been claimed; returns `{canceled: true}`. |
| `GET /checkout/orders/:orderId` | Current payment state, quoted and actual paid amounts. |
| `POST /checkout/orders/:orderId/resume` | PaymentSheet configuration for the **same** unresolved intent. |
| `POST /checkout/orders/:orderId/cancel` | Ask Stripe to cancel an abandoned intent; release the item only when cancellation is verified. |

Errors retain `{error: string}` and add a checkout-specific `code`. Examples:
`unsupported_retailer`, `quote_changed`, `cancel_watch_first`,
`payment_in_progress`, `card_setup_required`, `reconciliation_required`.
Do not send an amount, merchant, Customer ID, or PaymentMethod ID to Buy Now;
unexpected body fields are rejected. All sensitive intent/session secrets must
stay out of logs, analytics, URLs, and persistent client storage.

### Buy Now

1. Load `/checkout/items/:itemId`. Use **that quote** to show the merchant and total;
   client-writable `items.best_listing` is not payment authority. An unregistered
   real-retailer item returns `eligible: false` and has no checkout capability.
2. Generate a request UUID once per deliberate purchase and preserve it across
   retries. Send it with the displayed offer revision. `quote_changed` means fetch
   and display the new quote before submitting a new attempt.
3. Initialize the already-declared Stripe React Native SDK with `publishableKey`.
   Pass `customerId`, `customerSessionClientSecret`, `merchantDisplayName`, and
   `paymentIntentClientSecret` to `initPaymentSheet`, then present it.
4. Read `/checkout/orders/:orderId` after confirmation. Only server-confirmed
   `succeeded` is a purchase. Closing PaymentSheet does not cancel the intent;
   retain its order ID to resume or call the cancel endpoint to abandon it.

Buy Now does not silently save/authorize a card for autobuy. An active watch must
be canceled before beginning a separate Buy Now purchase for the same item.

### Save a test card and set a threshold

1. Show `/checkout/config`'s consent text and collect explicit agreement. Create
   a SetupIntent and initialize PaymentSheet with `setupIntentClientSecret` (not
   `paymentIntentClientSecret`), Customer/CustomerSession, and merchant name.
2. In the eventual UI, enter `4242 4242 4242 4242`, any future expiry, any three-digit
   CVC, and a test postal code. Never enter a real card. The backend demo uses
   `pm_card_visa` instead; the customer-facing API never accepts raw card details.
3. After successful setup, submit the returned `setupIntentId`, threshold, and
   consent version to the autobuy endpoint. The server retrieves the SetupIntent
   and checks ownership and success independently of the client callback.
4. The threshold authorizes one purchase of this item from the fake retailer,
   including shipping. Changing/re-enabling a threshold requires renewed explicit
   consent. The first poll can buy immediately if the offer already qualifies.

The saved card is bound to that authorization. Declines/authentication requirements
pause it. Use the order's resume endpoint to bring the customer back on-session;
the watcher never repeatedly confirms a declined card. Alternatively cancel the
order and then set up/re-enable a watch with a new card. Card removal in the
CustomerSession is disabled so the sheet cannot silently detach an active
watch's payment method. Cards are only redisplayed when Stripe's redisplay consent
allows it; the explicit SetupIntent remains sufficient for the chosen autobuy.

### Existing library and future UI integration

- Payment fields are server-controlled. `stopWatching` now calls the API; do not
  directly update `target_price` or `checkout_status` from Supabase client code.
- Library states remain `none | watching | purchased`. Detailed states such as
  `requires_action` and paused watches come from the checkout API. A paused watch
  projects to `none` while retaining its threshold, and must be resolved through
  its existing order before a new payment can be created.
- The existing detail screen's `target_price ?? listing total` purchase display
  is **not a receipt**. When integrating the new UI, display the order's
  `paidAmountCents`, including after item-price changes. Do not label a threshold
  as the amount paid.
- Deleting an unclaimed watched item removes its watch. Deleting an unresolved
  payment is rejected; purchased-item deletion preserves the order receipt.
- Confirm the existing TestFlight binary includes Stripe. The future UI must add
  StripeProvider/PaymentSheet and configure URL callbacks for authentication.
  `app.json` currently has no return URL scheme. Coordinate any native/config
  change with Havel; this backend change adds no native package or build change.

## Hook up the future algorithm

The scoring contracts are unchanged. The backend currently operates against an
explicitly registered fake offer and does not infer merchant identity from an
editable JSON listing or force the sandbox offer to win the ranking.

The server-side integration point is the service-role-only
`checkout_register_offer(p_item, p_title, p_price, p_shipping, p_merchant)` RPC.
Use it for the sandbox offer attached to a saved item; its returned `id` is stable
and `revision` increases with each update. Prices supplied by this adapter must
come from trusted server-side sandbox data, never a mobile-submitted listing.
Use Cedar Electronics as the merchant to match the account and consent wording.
Do not register real retailer listings through this RPC.

The listings owner can expose this sandbox offer as `source: "sandbox"` when
`DEMO_MODE` is enabled, rank it normally, and use the checkout quote when its
purchase action is selected. Sandbox listings must remain excluded from reference
medians. Price-history/scoring refreshes and suggested thresholds are owned by
that later integration; this module does not implement them. The user can watch
the fake offer even while another store is cheaper, but cannot buy that real store.

## Reliability and operations

- PostgreSQL claims and a unique active-order index serialize Buy Now/autobuy,
  cancellation, offer edits, and deletion for an item. Different server processes
  can discover a watch simultaneously without producing different orders.
- Stripe creates use durable order-based idempotency keys. Unknown outcomes retain
  the claim. Each polling pass first reconciles unresolved orders, then evaluates
  active watches. Restarting the server preserves state.
- An unknown Stripe create older than 23 hours stops retrying, before Stripe can
  prune its idempotency record. If `reconciliation_required` occurs, locate the
  intent in the sandbox dashboard by `metadata.midas_order_id`, then run:

  ```sh
  npm run checkout:demo -- reconcile ORDER_UUID pi_EXISTING_INTENT
  ```

  This retrieves and validates the intent before binding it. Never delete the
  order or mark it canceled just to force a new charge. If customer creation was
  interrupted for more than 23 hours, locate the Customer by `midas_user_id` and
  restore `checkout_customers.stripe_customer_id` through the trusted SQL editor.
- Webhook event IDs and purchase state commit together. Failed persistence returns
  an error so Stripe retries. Polling provides additional reconciliation if the
  listener was offline.
- Logs contain HTTP status/timing and aggregate polling failures, never provider
  error bodies, card details, or client secrets. Investigate `checkout_poll_errors`
  in the sandbox dashboard and server-owned order rows.
- This is a small hackathon loop, not a production queue. Each query supports up
  to 1000 matching records, and polling stops when the API process is offline.
  Use a fresh small demo dataset; larger scale needs pagination and a durable job
  system. Push notifications and real-retailer scheduled checks are not included.

## Validation

From `server/`: `npm test`, `npm run typecheck`, `npm run build`. From the repository
root: `npm run typecheck`.

Tests execute the actual checkout migration in an isolated PGlite PostgreSQL
database with Supabase-style roles/RLS. Stripe responses are mocked; separate SDK
tests check actual serialized requests, idempotency keys, and webhook signatures.
They cover success, shipping thresholds, duplicate claims, lost responses,
restart, declines, authentication recovery, deletion, ownership, and restricted
payment fields. PGlite uses one connection; it checks transaction behavior and
constraints but is not a load test of simultaneous PostgreSQL connections.

The sandbox demo command verifies actual Stripe/Supabase integration only when
explicitly run against a migrated, configured environment. Mobile card entry and
3DS return-to-app behavior still require the future iPhone UI.

References: [Stripe sandboxes](https://docs.stripe.com/sandboxes),
[test cards](https://docs.stripe.com/testing),
[SetupIntents](https://docs.stripe.com/payments/setup-intents),
[mobile payments](https://docs.stripe.com/payments/mobile/accept-payment?platform=react-native&type=payment),
[webhooks](https://docs.stripe.com/webhooks),
[idempotency](https://docs.stripe.com/api/idempotent_requests).
