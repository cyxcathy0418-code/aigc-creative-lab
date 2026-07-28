# ADR-002: Phase 1 product data and Spec extraction

- **Status:** Accepted
- **Date:** 2026-07-28
- **Scope:** Phase 1

## Context

The PRD originally proposed Prisma, NextAuth, Stripe credits and a copied SaaS starter. Phase 0 established a clean Next.js app with Supabase Auth. The user subsequently approved a Supabase-native data layer, no Phase 1 billing, and local reuse of the existing OpenAI key. Any paid action still requires an action-time confirmation.

## Decisions

1. Use Supabase PostgreSQL directly through the authenticated server client. Do not add Prisma or a service-role key.
2. Store the user brief in `products`, private object metadata in `product_reference_images`, and the validated ProductSpec as versioned JSONB in `product_specs`.
3. Enable RLS on all three tables. A user can only read or mutate rows owned through `auth.uid()`.
4. Keep the `product-assets` bucket private. Paths use `{user_id}/{product_id}/{uuid}.{extension}`; the database stores only the path.
5. Accept 1–3 JPEG, PNG or WebP images, with a 10MB maximum per file. The first image is the primary reference.
6. Port the Python Spec prompt and ProductSpec validation to TypeScript/Zod, including all `brandMarking` conditional rules.
7. Use the OpenAI Responses API behind `SpecExtractionProvider`. The default implementation uses image input and strict JSON Schema output. The model is configurable and defaults to `gpt-5-mini`.
8. Retry extraction at most three times. Invalid structured output is fed back as a concise validation error. A final failure is persisted and shown to the user.
9. Require `OPENAI_SPEC_EXTRACTION_ENABLED=true` in addition to an API key. This prevents accidental billable calls before the user approves a live validation run.
10. Do not add credits, Stripe, campaign generation, A/B evaluation or public deployment in Phase 1.

## Consequences

- Product data is isolated without maintaining an ORM layer or a privileged application database client.
- ProductSpec can evolve without a destructive column migration, while Zod remains the application contract.
- The UI and API can be fully built and tested without spending OpenAI credits.
- A live end-to-end extraction remains intentionally blocked until the user explicitly confirms the cost.

## Authentication note

Supabase's free default SMTP sends the stock magic-link template, while the
dashboard requires custom SMTP before that template can be edited. The initial
SSR PKCE implementation failed when the request and email click occurred in
different browsers because the verifier is browser-local. During local Beta,
the login request therefore uses Supabase's implicit browser flow and the
client confirmation page converts the returned fragment tokens into SSR
cookies. PKCE code exchange and future token-hash verification remain supported
as compatibility paths. A separately approved custom SMTP provider is still
required before production Beta email delivery.

To keep Phase 1 development independent from the hosted email quota, the local
app also has an explicitly gated anonymous Supabase login. It is displayed only
when `NODE_ENV` is not production and `DEV_LOGIN_ENABLED=true`. Because the
browser owns the session cookie, it establishes this session directly.
Protected routes and APIs reject anonymous users in production. Both anonymous
sign-ins and project-level new-user signup must be disabled before external
deployment. This preserves real authenticated RLS and Storage behavior without
becoming a production authentication path.
