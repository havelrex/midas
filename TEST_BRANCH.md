# main-test workflow

## Pedro: quick start on Mac

Pull `main-test`, run `npm ci`, then configure your own ignored root `.env` with
the team's test Supabase public URL/key and staging `EXPO_PUBLIC_API_URL`.
Never copy backend-only secrets into public Expo variables.

```sh
git switch main-test
git pull --ff-only origin main-test
npm ci
npm run start:test
```

This command enables the fixture for Metro without editing .env. Connect a
compatible development client. Simulator UI testing needs an already installed
compatible simulator build; a physical-device TestFlight app cannot run on the
simulator. Native generation/signing remains coordinated with Havel under
CLAUDE.md. To test real Gemini, keep the same session and use the camera instead
of the fixture (real camera testing needs an iPhone).

Expected checks: load fixture without granting camera access; open details;
confirm 78/Wait/$120; tap checkout and see the test handoff alert; discard then
Undo; reload and save to the test database; Undo the save. The unsaved detail
draft has an empty ID and must not be sent directly to a checkout API requiring
a persisted item. The existing save flow initializes target_price to null;
the $90 target is currently available on the unsaved fixture detail only.

Stripe is NOT integrated on main-test yet. Merge Pedro's reviewed checkout work
into this branch and connect ItemDetailView's onCheckout callback before testing
PaymentSheet or PaymentIntents. The alert is a handoff placeholder, not a mocked
successful payment. Do not infer Stripe readiness from UI/build checks alone.

Enable the test tools in the app's build/Metro environment:

```dotenv
EXPO_PUBLIC_TEST_TOOLS=true
```

Restart Metro after changing the flag. Standalone TestFlight builds must be
bundled with the flag; editing a laptop .env does not update an installed build.
Native packages have not changed. Without this exact flag the test tools are hidden.

After sign-in, tap **Load dummy item**. Camera permission is not required. The
bundled app icon is used as an offline placeholder image. This loads a fictional
headphone with a fixed score of 78, Wait verdict, $120 listing and $90 target.
Loading the fixture never calls Gemini or the scoring backend. Retake returns
to the ordinary camera flow for testing real Gemini identification.

Use the existing card to test tap-to-expand, sub-score reasons, swipe discard,
Undo, swipe save and undo-save. Save uses real Supabase auth, storage and RLS,
so sign in with a test account and use the team's test database. Saved rows are
prefixed [TEST]; remove them when finished. Do not use a production database.

The fixture's best_listing is a fictional test merchant with a non-resolving
example.invalid URL, not a purchasable retailer listing. The detail sheet carries
the target price for checkout integration. Checkout in this checkout of the app
is still a TODO callback; no Stripe charge is wired or simulated by this fixture.
Pedro can connect the fixture to his Stripe test-mode flow after his branch is
merged. Use only Stripe test credentials and test cards for that work.

Develop features on individual branches, then integrate on main-test. A branch
does not itself enable test tools or update an installed iPhone app. Use a
Metro-enabled development client for JS/UI reloads, or distribute a standalone
test build. Point a separate staging backend at main-test; do not switch the
shared production backend during experiments. Keep the flag unset in release builds.
