# Snap & Score API

Small TypeScript/Express backend for the iOS app. This foundation provides startup,
Supabase authentication, JSON errors, and tests. Listing search, scoring,
checkout, and price watching will be added separately. Gemini identification is
available through the authenticated `POST /analyze` endpoint.

## Start locally

Use Node.js 22 or newer. From the repository root:

```sh
cd server
npm install
npm run dev
```

The backend reads the **repository-root `.env`**, regardless of the working
directory, in both development and compiled mode. Existing exported environment
variables take precedence. Keep your existing `.env`; do not overwrite its keys.
For a fresh checkout, copy the root `.env.example` to `.env` and fill in:

```dotenv
PORT=4000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-project-anon-key
```

`PORT` defaults to 4000. The URL and anon key are required. Auth uses local JWKS
verification, falling back to Supabase's `getUser(token)` for legacy signing keys
or unavailable JWKS. `SUPABASE_SERVICE_ROLE_KEY` is only required if future
automation explicitly calls `createSupabaseAdmin(config)`; it is not used by `/me`.
The Gemini key is optional at startup but required for `/analyze`. Shopping and
Stripe keys are not required yet. Never give server secrets
an `EXPO_PUBLIC_` prefix or commit `.env`.

Keep the server terminal open. In another terminal:

```sh
curl http://localhost:4000/health
```

Expected: `{"status":"ok"}`. Health checks process liveness without calling providers.
`GET /me` requires `Authorization: Bearer <Supabase access token>` and returns
`{"userId":"..."}`. Missing or invalid tokens return 401. Routes have no `/api` prefix.

## Connect the iPhone app

Set the root `.env` value `EXPO_PUBLIC_API_URL` to a backend URL reachable from
your iPhone, such as `http://<your-computers-LAN-IP>:4000` on a network allowing
device-to-device access, or an HTTPS tunnel forwarding to port 4000. The server
listens on `0.0.0.0`. On the phone, `localhost` refers to the phone itself.
The Expo tunnel exposes Metro, **not this API**; venue Wi-Fi may require a
separate backend tunnel. Restart Expo after changing the URL.

From signed-in mobile code, use the existing helper:

```ts
const { userId } = await apiFetch<{ userId: string }>('/me');
```

The helper attaches the session's access token. This is the manual end-to-end
auth check; automated tests use local fixtures and never require real accounts.
No UI or native build change is required by this backend foundation.

## Product identification

Add `GEMINI_API_KEY` to the repository-root `.env`, not `.env.example`.
Optionally set `GEMINI_MODEL` (default `gemini-3.5-flash-lite`). Restart the API
after changing these values. This implementation calls Google's REST API and
adds no SDK dependency. Never put the Gemini key in an `EXPO_PUBLIC_` variable.

`POST /analyze` requires a Supabase bearer token and JSON:

```json
{ "imageBase64": "<raw base64, no data URL prefix>", "mimeType": "image/jpeg" }
```

JPEG and PNG uploads up to 6 MB decoded are accepted. Success returns the
`AnalysisOutput` fields from `shared/contracts.ts` directly. Unknown brand/model
fields are empty strings. Confidence is an uncalibrated model heuristic. Missing
configuration returns 503, provider quota 429, provider timeout 504, and invalid
provider output 502. Images and keys are not logged or persisted by this server.

The camera automatically resizes captured photos to width 1280, compresses to
JPEG, calls `/analyze`, and displays product information. Retake cancels pending
work; retry identification reuses the captured photo. Configure a phone-reachable
`EXPO_PUBLIC_API_URL` and sign in first. No scoring or saving is performed yet.
The existing native build must include the already-declared
`expo-image-manipulator` dependency.

Run `npm test` to verify the route and Gemini client with mocked provider calls.
Live model accuracy, account quota, and real camera behavior still require manual
testing with your configured key and iPhone.

## Check and build

Run these from `server/`:

```sh
npm test
npm run typecheck
npm run build
npm start
```

Stop the dev server before starting the compiled server on the same port.
Ctrl+C/SIGTERM drains requests, with a ten-second shutdown deadline.
Run `npm run typecheck` from the repository root separately to check the mobile app.

## Add features

- `src/index.ts`: configuration, provider wiring, listening, and shutdown.
- `src/app.ts`: middleware and route registration; importing it does not start a server.
- `src/routes/`: small Express routers. Protect user routes with
  `requireUser(verifyToken)` and use the verified `req.userId`.
- Add provider/business modules under `src/analysis`, `src/listings`,
  `src/scoring`, and `src/checkout` when those features are implemented.
  Keep network calls and scoring logic out of route handlers.
- Follow `shared/contracts.ts` and coordinate changes with the contract owner.
  The app continues accessing its library directly through Supabase/RLS.
- Register future Stripe webhook routes with `express.raw({ type: 'application/json' })`
  **before** the JSON API router in `app.ts`; verify the signature before using the body.
  There is no checkout or webhook endpoint yet.

Ordinary JSON bodies are limited to 10 MB (including base64 image overhead).
Errors use `{ "error": "message" }`: malformed JSON 400, oversized body 413,
unsupported encoding 415, unknown route 404, unexpected error 500.
Request logs contain method, path, status, and duration; never put secrets in URL
paths. Headers, query strings, bodies, and raw provider errors are not logged.
There is no browser frontend here, so CORS middleware is not needed for the native app.
