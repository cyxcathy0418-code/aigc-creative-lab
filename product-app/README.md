# Brand Anchor Studio — product app

The customer-facing application for Brand Anchor Studio. The existing Python/Streamlit application at the repository root remains the internal experimentation lab.

## Phase 1 scope

- Public landing page at `/`
- Invite-only email login at `/login`
- Product workspace at `/dashboard`
- Private 1–3 image upload and product brief at `/products/new`
- Zod-validated, editable ProductSpec at `/products/[id]/spec`
- Authenticated product APIs under `/api/products`
- Supabase-native tables, RLS and private Storage
- OpenAI Responses API adapter with three-attempt extraction and a billable-call safety gate

Campaigns, advertisement image generation, credits and payment remain deferred.

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

`npm run test` performs a production build, ProductSpec boundary tests and route-level smoke tests. It does not call OpenAI.
