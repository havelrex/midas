# Visual identification evaluation

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
