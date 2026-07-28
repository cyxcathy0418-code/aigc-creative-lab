# ADR-001: Product foundation

- **Status:** Accepted
- **Date:** 2026-07-28
- **Scope:** Phase 0

## Context

The repository contains a Python and Streamlit experimentation environment. The customer-facing product needs a separate web foundation without discarding the validated experimental work or copying a starter whose license is unclear.

## Decisions

1. Keep the existing Python application as an internal lab. Build the customer-facing product inside `product-app/` with Next.js 16, React 19, TypeScript and Tailwind.
2. Launch with a public product page and an invite-only Beta. Beta users are created or invited manually in Supabase; the application does not offer self-registration.
3. Use Supabase Auth, PostgreSQL and Storage. Browser and server clients are separate, authentication uses cookie-backed sessions, and protected routes are checked on the server.
4. Product images live in a private Storage bucket. PostgreSQL records object paths, not permanent public URLs. Access will use authorization policies and short-lived signed URLs.
5. OpenAI is the initial image-generation provider, but product code depends on a `GenerationProvider` interface. Phase 0 implements only the boundary and sends no generation request.
6. Do not integrate Stripe in Phase 0. A future credit ledger must support reservation before generation, settlement against actual usage, and release or refund after failure.
7. Do not create a Supabase project, Vercel project or other external resource in Phase 0. No production key is copied into the frontend.
8. Do not modify or revert the existing Python work while establishing this product foundation.

## Consequences

- The product app can evolve independently while the Python lab remains useful for experiments and evaluation.
- Missing Supabase configuration is an explicit, usable local state rather than a runtime failure.
- Phase 1 can begin with product profiles and private uploads without changing the authentication or storage boundary.
- Phase 2 can add a concrete OpenAI adapter and credit accounting without coupling the interface to one provider.

## Deferred

- Product profile schema and upload policies
- Product identity/specification workflow
- Image generation and provider fallback
- Credit pricing, Stripe and real payment
- Production deployment, monitoring and analytics
