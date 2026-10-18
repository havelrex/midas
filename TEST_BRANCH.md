# Shared main-test integration

This branch combines Stanley's navigation/UI/mock library, Pedro's sandbox
checkout backend, camera/Gemini changes, and a native checkout test screen.
No live payment keys are accepted. No actual products are purchased.

## Pedro: prerequisites

1. Pull main-test. Apply Supabase migrations 0001, 0002, then
   `supabase/migrations/0003_sandbox_checkout.sql` in the TEST project.
2. Follow `server/CHECKOUT.md` for the same-sandbox Stripe keys, webhook secret,
   Supabase service-role key, DEMO_MODE=true, and CHECKOUT_WATCHER_ENABLED=true.
   Configure the deployed staging backend too if the app points to Render.
3. Forward Stripe events to the running API, or register the deployed HTTPS
   /webhooks/stripe endpoint. Webhook setup is required for reconciliation.
4. Configure your ignored root .env with test Supabase public values and the
   phone-reachable EXPO_PUBLIC_API_URL. Never use public prefixes on secrets.
5. Use a compatible iOS development client containing the already-declared
   Stripe, camera and image-manipulator modules. Coordinate native build work
   with Havel per CLAUDE.md. No native packages/config were added in this change.

```sh
# Repo root
npm ci
npm run start:test
# Another terminal
cd server
npm ci
npm run dev
```

start:test enables EXPO_PUBLIC_TEST_TOOLS=true and sets
EXPO_PUBLIC_MOCK_LIBRARY=0. This is deliberate: mock-1 etc. are UI-only IDs, not
owned Supabase records, so they cannot be used for checkout. To inspect Stanley's
mock library instead, run normal Metro with EXPO_PUBLIC_MOCK_LIBRARY=1. Mock rows
are blocked from checkout. A standalone test build needs these flags when
bundling; a branch push does not change the installed UI.

## Shared sample data, not a second mock catalog

Load dummy item uses Stanley's first MOCK_ITEMS entry: Sony WH-1000XM5, score 72,
Wait, sample listing $328, sample target $299. It adds [TEST] to the name and uses
the bundled icon as a placeholder. It calls neither Gemini nor scoring. The
sample retail listing is not payment authority; only Pedro's registered sandbox
quote controls checkout. Retake returns to real camera analysis.

After sign-in, tap Load dummy item (no camera permission required), swipe to save,
open Library, then the saved item's detail and Checkout. Saving uses real test
Supabase/RLS and gives the item a UUID belonging to the signed-in tester. Use
that UUID shown on checkout to register an offer; no new fixture endpoint or
parallel mock backend was added. You can instead use an existing demo-account
item that already has a real Supabase UUID.

```sh
# In server/, operator setup; PRICE and SHIPPING are integer cents:
npm run checkout:demo -- offer ITEM_UUID 25900 500
```

Tap Refresh server status. Expect Cedar Electronics, $259 + $5 shipping = $264.
This intentionally overrides the UI sample's retail price for the payment quote.
The $299 draft target isn't saved by the existing save flow; enter the desired
checkout target explicitly. Do not seed mock-user or mock-* IDs into checkout.

## Buy Now

Use one saved test item with a registered offer. Tap Buy now (test), use test
card 4242 4242 4242 4242, future expiry, any CVC and test postal code. Expect
server order succeeded and matching test payment in Stripe. A PaymentSheet
callback alone does not mark a purchase. Refresh if confirmation is pending.
Closing the sheet leaves the existing order available to Resume or Cancel.
The UI retains the request UUID across retries while mounted; the backend
recovers pending orders after reopening. Confirm that repeated taps don't pay twice.

## Buy at target

Use a SEPARATE saved item/offer. Enter 200.00, read and accept the exact server
consent text, then save a test card and authorize. Expect an active watch and no
purchase at $264. Trigger the drop from the operator terminal:

```sh
npm run checkout:demo -- price ITEM_UUID 18000
```

After a watcher pass, Refresh server status. Expect succeeded and $185 paid
($180 + $5 shipping), rather than the $200 threshold. Verify in Stripe and Library.
Cancel auto-buy before starting Buy Now on that same item. Include decline,
sheet cancellation, stale quote and pending-order recovery tests; use the test
scenarios in server/CHECKOUT.md. Advanced redirect-based authentication still
needs native device testing and appropriate app return-URL configuration.

## Boundaries

The app never charges a mock-only or unsaved row. Unsaved camera detail directs
testers to save first. Gemini remains independent and uses the selected branch
only if that backend is actually deployed/running. No keys or migrations are
applied automatically. UI/native PaymentSheet behavior must be exercised on a
compatible iPhone/simulator build; Windows checks don't establish payment success.
Keep this integration on main-test until device and sandbox tests pass.
