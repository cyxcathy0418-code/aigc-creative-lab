# Creative Passport — Web Product

A browser-based advertising creative workspace for cross-border brands. It turns product information and confirmed facts into market-specific creative directions, editable storyboards, and downloadable 15-second videos.

**[Open the deployed private workspace](https://creative-passport-cathy-demo.cyxcathy0418.chatgpt.site)** · [Demo guide](./docs/DEMO_V1.md)

## Current deployed experience

The creator can sign in with their ChatGPT account and complete the workflow:

Product and facts → three creative directions → four-shot storyboard → confirmation → actual video rendering → revision and export.

- Switch between English and Chinese interface copy without changing the market or saved advertising content.
- Work with United States / English or Mexico / Spanish market contexts.
- Confirm facts and sources before generating a storyboard; preserve evidence snapshots on the relevant shots.
- Edit captions, lock shots, retain confirmed versions, and restore a version as a new draft.
- Encode a 15-second, 1080 × 1920, 30 fps H.264 MP4 in the browser, optionally with user-uploaded narration.
- Download MP4, SRT, and an internal preview package.
- Save product inputs, scripts, and versions through the deployed backend. Videos are cached on the current device and can be recreated from the saved inputs.

Creative suggestions currently use clearly labeled templates. The deployed demo does not call paid models. Its access boundary is creator-only; the application's Supabase email-invitation flow is a separate integration.

## Shared implementation

The Next.js `/demo` entry point and the standalone hosting adapter share the same React workspace, Zod schemas, workflow service, and media modules.

| Directory | Responsibility |
|---|---|
| `components/passport-demo/` | Bilingual workspace, interface copy, and responsive styling |
| `lib/passport-demo/` | Facts, directions, storyboard validation, persistence adapters, rendering, and artifact caching |
| `demo-host/` | Standalone frontend build and HTTP / storage adapters |
| `app/demo/` | Next.js demo entry point |
| `supabase/migrations/` | Existing product schema and Creative Passport data foundations |

The deployed adapter uses a Cloudflare Worker with private R2-backed storage through Sites. The local standalone server uses a development-only file store. The original Next.js / Supabase application remains in this directory.

## Run the standalone demo

Requirements: Node.js 22.13 or newer. Check out `feature/creative-passport` first.

```bash
npm ci
npm run demo:build
npm run demo:dev
```

Open `http://127.0.0.1:4173`. No model credentials are required for this template-based demo. See [DEMO_V1.md](./docs/DEMO_V1.md) for hosting preparation and verification boundaries.

## Run the Next.js application

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Copy `.env.example` to `.env.local` and configure your own isolated Supabase test project for protected product routes. Keep model secrets server-side and keep billable feature flags disabled until a live test is explicitly authorized. Blank configuration does not connect a service.

The existing application includes product upload, editable ProductSpec, creative-batch derivation, reference-image-conditioned generation, and private asset export. Source code for these integrations does not mean that each service is enabled in the current demo environment. See [Supabase setup](./SUPABASE_SETUP.md) and the [Next.js deployment checklist](./DEPLOYMENT.md).

## Checks

```bash
npm test
```

The current suite builds the Next.js application and runs 64 automated checks. External credentials are cleared and paid model calls are disabled. Checks cover product schemas, authorization assumptions, routes, market mappings, data foundations, source-backed demo workflows, version boundaries, and export behavior.

## Product data foundations

Creative Passport adds projects, source-backed facts, immutable Spec / creative revisions, normalized markets and locales, and separate Campaign → Ad Group → Ad draft tables. Existing `campaigns` records and routes remain legacy creative batches.

Foundation migrations have been checked locally in an isolated PGlite database; that is distinct from deployment to a hosted Supabase project. The complete advertising-draft interface is part of the broader product scope. Historical implementation details remain in [CREATIVE_PASSPORT_FOUNDATION.md](./CREATIVE_PASSPORT_FOUNDATION.md).

## Next product stages

- Connect a real text provider for fact-grounded directions, scripts, and local revisions, with recorded usage and bounded costs.
- Complete invite-only email access, private multi-project workspaces, and per-user quotas.
- Add persistent production jobs, speech synthesis, recovery, and cloud video storage.
- Extend Campaign / Ad Group / Ad draft editing and asset associations.

The original Python / Streamlit lab stays at the repository root and continues to use Pydantic. The web workflow uses TypeScript and Zod. The full internal product requirements remain in [Creative-Passport-PRD.md](./docs/Creative-Passport-PRD.md).
