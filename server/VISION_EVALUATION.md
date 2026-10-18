# Visual identification evaluation

## camera-analysis-optimization changes

This branch starts from ultimate-test, including its scoring and checkout work.
The vision prompt now checks category-specific features and visible
contradictions with the nearest rival instead of relying on popularity or logos.
The candidate thresholds and public AnalysisOutput contract are unchanged.

Camera capture quality is 0.9. Uploads preserve aspect ratio, do not upscale,
limit the longest edge to 1600px, and use JPEG quality 0.85. This retains more
detail than the previous double compression at quality 0.7. Larger uploads can
increase latency and provider token cost. Device validation remains necessary.

Optionally set GEMINI_VISION_FALLBACK_MODEL to a stronger vision model available
to the team's Google project. It is unset by default: there is no additional
call/cost unless enabled. The primary model is still GEMINI_MODEL. A fallback is
used only when a product category is recognized but the exact model is unresolved.
The second model gets the original image without the first model's guesses,
uses the same evidence rules, and conflicting brand results are discarded. A
failed fallback preserves the initial family result. Requests allow 18 seconds
for the first pass and 12 for fallback when enabled; network/provider slowness
can still leave identification unresolved. Do not configure the same model twice.
This is inference, not catalog verification, and does not guarantee correctness.

## Repeatable saved-photo test (no TestFlight rebuild)

From server/, with a server-only GEMINI_API_KEY in the ignored root .env:

```sh
npm run analyze:photo -- --image /path/to/headphones.jpg --expected-model WH-1000XM5
npm run analyze:photo -- --image /path/to/headphones.jpg --model YOUR_COMPARISON_MODEL --expected-model WH-1000XM5
npm run analyze:photo -- --image /path/to/headphones.jpg --fallback-model YOUR_STRONGER_MODEL --expected-model WH-1000XM5
```

Each command explicitly sends that image to Google and consumes API quota. It
prints public product JSON, elapsed time and correct/incorrect/unresolved outcome.
Use --expected-model "" for a product whose exact model is genuinely ambiguous.
This bypasses HTTP authentication, resizing and scoring to isolate vision; test
the camera upload separately. No API key, raw provider response or image data is
printed. Model IDs must exist and support the request schema in your project.
The test command doesn't require the backend to be deployed or the API to run.

Backend prompt/fallback changes can be tested by restarting/deploying this
branch behind the app's existing URL. The capture-quality change requires new
JavaScript loaded through Metro or a new standalone app bundle, not new native
dependencies. Do not deploy to the shared ultimate-test backend without team
coordination. Automated tests mock Gemini and do not demonstrate accuracy gains.

The vision prompt now considers up to three candidate models using silhouette,
controls, ports, hinge geometry and branding even when a label is not readable.
Candidate evidence stays internal; `/analyze` still returns the shared six-field
contract. A model is selected only if the response is unambiguous, its heuristic
confidence is at least 0.85, its lead is at least 0.15, and it has two distinct
evidence strings or a readable model label. These thresholds need empirical tuning.
Evidence and confidence are model-generated, not independent verification.
Listing/catalog verification is not implemented because the merged backend has
no catalog client yet. Do not describe inferred models as verified matches.

## Manual comparison before merging

Use the same model ID and the same photos for old and new code. Keep photos local;
do not commit personal photos or keys. Test at least five known electronics,
with three photos each: front without label, side/controls, and readable label.
Include visually identical generations, generic products, blur and no product.
Record ground truth, returned brand/model, correctness, whether the model was
left unknown, and response time. Repeat the label-free photos to check stability.

Compare correct exact-model identifications, incorrect exact-model assertions,
and unresolved results separately. Fewer unresolved results alone is not success.
For identical generations the expected result is an unresolved exact model.
Confidence scores are not measured probabilities.

Run the server from this branch and point the existing iPhone app at it. These
are backend-only changes and require no native rebuild. Hosted backends must
deploy this branch before the new prompt takes effect. Keep scoring integration
out of this evaluation until product identity is confirmed.

To compare a stronger vision model, change only `GEMINI_MODEL` in the backend
environment to a supported model available to the team and repeat the same set.
Account quota, latency and cost differ. No automatic second model call was added.
