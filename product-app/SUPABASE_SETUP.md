# Supabase setup and Phase 1 state

Connected project: `rislccnxyvmjjgfhwyco` (Supabase Free Plan, Sydney).

## Completed

- Project URL and browser-safe publishable key are configured in the ignored `.env.local`.
- Auth Site URL is `http://localhost:3000`; allowed redirects include both
  `/auth/callback` (legacy) and `/auth/confirm` (current).
- Project-level new-user signup and anonymous sign-in are temporarily enabled
  for local development. The application email flow remains invite-only through
  `shouldCreateUser: false`, and social providers remain disabled.
- Email authentication remains enabled.
- Phase 1 migration is stored at `supabase/migrations/202607280001_phase1_product_foundation.sql` and has been applied.
- `products`, `product_reference_images` and `product_specs` have RLS enabled.
- `product-assets` is private and scoped by the first object-path folder (`auth.uid()`).

Never put a `service_role` key in `NEXT_PUBLIC_*` or in a client component.

## Local development login

The hosted project temporarily allows anonymous sign-ins so local development
can exercise real Supabase cookies, RLS and private Storage without using the
rate-limited email service.

The login page exposes this control only when both conditions are true:

- `NODE_ENV !== "production"`
- `DEV_LOGIN_ENABLED=true`

The browser calls `signInAnonymously` directly and stores the resulting session
in the same Supabase SSR cookie format used by the product. Protected pages and
product APIs reject `user.is_anonymous` whenever `NODE_ENV` is production.
Every production and preview environment must leave the flag unset or false.
Before the first external deployment, turn off both **Allow anonymous sign-ins**
and **Allow new users to sign up** in the Supabase dashboard.

## Passwordless login

The confirmation page supports three modes:

1. The default Supabase template uses the implicit browser flow and returns
   access/refresh tokens in the URL fragment. The page immediately removes the
   fragment, stores the session in Supabase SSR cookies and enters `/dashboard`.
   This avoids the cross-browser PKCE verifier failure during the local Beta.
2. Existing PKCE links with a `code` remain supported when opened in the
   originating browser.
3. After custom SMTP is separately approved, the template can use a token hash.

For the second mode, set **Authentication → Email Templates → Magic Link** to:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">
  Sign in to Brand Anchor Studio
</a>
```

The Supabase dashboard does not allow template editing while the project uses
its default SMTP service. That service is suitable only for development and has
a very low email limit. Configure a separately approved custom SMTP provider
before inviting external Beta users. The application always uses
`shouldCreateUser: false`, so an unknown email cannot self-register.

## Phase 1 live extraction gate

`OPENAI_SPEC_EXTRACTION_ENABLED=false` is intentional. Before a live model call:

1. Confirm the expected OpenAI cost with the user.
2. Copy the existing root `OPENAI_API_KEY` into the ignored product `.env.local`.
3. Set `OPENAI_SPEC_EXTRACTION_ENABLED=true`.
4. Run one representative 1–3 image extraction and turn the flag off again if no further paid testing is approved.

## Live end-to-end verification (2026-07-29)

Ran the full Phase 1 + Phase 2 chain once against the real OpenAI API (dev-login
session, one reference image from `artifacts/ab_experiments/cb7a3abb932641f2`):

1. `POST /api/products` — Spec extraction succeeded on attempt 1, including the
   `brandMarking` conditional branch for `markType=unreadable`.
2. `POST /api/campaigns` — 2-market creative derivation succeeded on attempt 1.
3. `POST /api/campaigns/:id/generate` — one `1024x1024`/`low` image generated via
   `images.edit` with the real reference image; the result visibly carried over
   the pink glossy tube color, silhouette and silver keyring hardware.

All three `OPENAI_*_ENABLED` flags were reset to `false` afterward. This is the
first live confirmation that the Phase 1/2 acceptance criteria in the PRD are
met by the actual deployed code path, not only by the mocked test suite.
