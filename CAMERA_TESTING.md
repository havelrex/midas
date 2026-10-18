# Camera build handoff

The camera screen opens after Supabase sign-in. It supports permission requests,
rear-camera preview, capture, photo preview, and retake. Gemini identification
now runs after capture; see `server/README.md` for backend setup.

## Havel: prepare the iPhone build on your Mac

1. Pull the reviewed camera-analysis changes into the build checkout.
2. Run `npm ci` and `npm run typecheck`.
3. Set real `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` values in your local environment before
   bundling. Never use the service-role key in the mobile app.
4. Follow the team's native build process in `CLAUDE.md`. Regenerate the iOS
   project when needed so the camera permission and merged native dependencies
   are included. Keep your existing signing, bundle ID, and team settings.
5. For TestFlight, ensure the build number is unused, archive, upload, and invite
   Caleb to the internal testing group. These steps belong to Havel.

Confirm whether the distributed build supports loading Metro through
expo-dev-client. A normal Release archive with bundled JavaScript can test the
camera independently, but does not automatically provide Metro/Fast Refresh
just because expo-dev-client is installed. Use the team's configured development
client distribution for live JavaScript changes.

## Caleb: run the development server

For a build configured to load Metro:

```powershell
npm.cmd ci
npm.cmd run start:camera
```

Set the same public Supabase variables locally before starting Metro. Install
the team's iPhone build and open its development server link or scan the QR
code. Use Midas (the TestFlight dev build), not Expo Go. The ngrok tunnel avoids the signed Expo
tunnel login problem encountered on this Windows machine.

For a standalone TestFlight build, launch the app directly; Metro is not needed.

## On-device checks

- Sign in and confirm the rear-camera preview appears.
- Allow camera access, capture a product, and verify the photo orientation.
- Retake several times; each preview should show the latest capture.
- Tap the shutter rapidly; only one capture should run at a time.
- Background and reopen the app; the camera should resume.
- Deny camera access in iOS Settings, reopen the app, and verify the Settings
  recovery button. Restore permission and confirm the preview returns.

A Gemini key and reachable backend are needed for identification. Camera capture
and retake still work when the backend is unavailable. Captures use the app cache;
compressed copies are sent to the backend and Gemini for identification, but are
not saved to the library. Use ordinary product photos when testing.
