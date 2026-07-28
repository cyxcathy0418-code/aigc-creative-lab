# Brand Anchor Studio — product app

The customer-facing application for Brand Anchor Studio. The existing Python/Streamlit application at the repository root remains the internal experimentation lab where the anchor mechanism was first validated (see `../PROJECT_GROUND_TRUTH.md`).

## What's built (Phase 0–3)

- Public landing page at `/`; invite-only email login at `/login` (plus a
  dev-only anonymous login gated by `DEV_LOGIN_ENABLED`, never available in
  production).
- Product workspace at `/dashboard`; private 1–3 image upload and product
  brief at `/products/new`; Zod-validated, editable ProductSpec at
  `/products/[id]/spec`.
- Campaign creation and multi-market creative derivation at
  `/products/[id]/campaigns/new` and `/campaigns/[id]/creatives`.
- Reference-image-conditioned ad image generation (OpenAI `images.edit`,
  never text-only) and a side-by-side reference/output comparison view at
  `/campaigns/[id]/assets`, with single-image and packaged-ZIP download.
- Supabase-native tables, RLS and private Storage throughout; every billable
  OpenAI call (Spec extraction, creative derivation, image generation) sits
  behind its own `OPENAI_*_ENABLED` feature flag, default `false`.
- Verified once end-to-end against the real OpenAI API (not just the mocked
  test suite) — see the "Live end-to-end verification" note in
  [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

## Roadmap — planned, not yet done

These are real gaps, written here so the plan is visible before it's built,
not backfilled after:

- **Quality eval set before inviting outside users**: 10–12 real products
  across all five `brandMarking` types × 2 markets each, human-scored on the
  existing 5-dimension fidelity rubric, with hard-fail checks (wrong product,
  hallucinated brand marks, copy-placeholder leaks, compliance violations).
  Designed, not yet run.
- **Platform-specific creative differentiation**: `platform` is currently a
  free-text field with no structured policy behind it (unlike
  `MARKET_LOCALIZATION_POLICIES`). A `PLATFORM_POLICIES` table (aspect
  ratio, hook pacing, marketplace image-content rules) is designed but not
  implemented.
- **Observability**: no LangSmith/tracing in this app (the Python lab used
  LangGraph + LangSmith; this app calls the OpenAI SDK directly with
  hand-rolled bounded retries). Per-call token usage/cost is stored in
  Postgres, but there's no step-by-step trace view.
- **Billing**: no Stripe/credits. Deliberately deferred until invite-only
  Beta usage validates real demand — see `../HANDOFF.md` for the reasoning.
- **Production deployment**: not deployed. Before any external invite:
  disable Supabase anonymous sign-in and self-registration, configure a
  real SMTP provider (current one is dev-only, low quota), add OpenAI usage
  alerts, and deploy (Vercel, matching the original PRD; some stray
  Cloudflare/wrangler scaffolding in this tree predates that decision and
  should be cleaned up rather than treated as a choice already made).

## Local development

Requirements: Node.js 22.13 or newer.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open `http://localhost:3000`.

The connected Supabase project is configured only in the ignored `.env.local`. See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for the current login decision and live extraction gate.

## Checks

```powershell
npm.cmd run lint
npm.cmd run test
```

`npm run test` performs a production build plus 29 automated tests covering
ProductSpec/campaign schema boundaries, creative derivation, image-generation
retries, ZIP packaging, authorization/RLS assumptions, and route-level smoke
tests. It does not call OpenAI — the live extraction/derivation/generation
gates above cover that separately.
