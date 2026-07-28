# ADR-003: Phase 2 campaign and reference-image generation boundaries

- Status: accepted
- Date: 2026-07-28

## Context

Phase 2 turns the confirmed Product Spec into localized market concepts and
then generates advertising images while preserving the real product. The PRD
suggested MuAPI first, an inherited starter-kit webhook, and credit deduction.
The current product instead uses native Supabase and has no billing system by
deliberate Beta scope.

## Decisions

1. **OpenAI is the launch provider behind explicit provider interfaces.**
   The project already has an OpenAI account and key, while adding MuAPI would
   create a second account, balance, security boundary, and failure mode.
   `CreativeDerivationProvider` and `GenerationProvider` keep a future provider
   swap possible.

2. **Reference images are mandatory for product image generation.**
   The OpenAI implementation calls `images.edit` with all saved product
   references. It never falls back to prompt-only `images.generate`.
   GPT Image 2 treats its input images at high fidelity, so the implementation
   does not send the legacy `input_fidelity` parameter.

3. **The data model separates intent, requests, and successful outputs.**
   `campaigns` pin the confirmed Spec version; `market_creatives` store one
   validated concept per market; `generation_jobs` record every request and
   failure; `generated_assets` exist only after a result is safely stored in
   the private bucket.

4. **No Stripe, credits, or automatic charging is introduced in Phase 2.**
   Paid capabilities are guarded independently by
   `OPENAI_CREATIVE_DERIVATION_ENABLED` and
   `OPENAI_IMAGE_GENERATION_ENABLED`, both false by default. Cost accounting
   metadata is retained for later pricing decisions.

5. **One image attempt per click is the Beta default.**
   Retry logic is implemented and tested up to three attempts, but
   `OPENAI_IMAGE_MAX_ATTEMPTS=1` prevents a transient error from silently
   multiplying paid image requests. A user can make an informed manual retry.

6. **The first Beta implementation is synchronous and one market is tested
   before a batch.**
   The API creates durable job state before calling the image provider and
   stores each result immediately. A queue/worker must replace the long-lived
   request before broad public launch if production duration measurements show
   that the deployment platform cannot reliably finish within its function
   limit.

## Consequences

- Phase 2 can be exercised end to end without making a second vendor decision.
- Failed generations are visible and do not create fake or placeholder assets.
- There is no application-level charge or refund behavior yet; that remains a
  post-quality-validation product decision.
- The final quality claim still requires human comparison of reference and
  output images. Automated schema and pipeline tests cannot establish visual
  fidelity.
