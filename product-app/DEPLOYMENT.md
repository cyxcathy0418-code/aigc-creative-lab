# Deployment checklist — before the first real external invite

This is a click-through checklist, not a decision doc. Each step involves an
account or dashboard you own; do them in order.

## 1. Deploy to Vercel

1. On vercel.com: **Add New → Project → Import** the `aigc-creative-lab`
   GitHub repo.
2. **Root Directory**: set to `product-app` (the repo has the Python lab at
   the root — Vercel needs to build from the subdirectory).
3. Framework preset should auto-detect Next.js. Leave build/output settings
   default.
4. **Environment variables** — add these (values from your local
   `product-app/.env.local`, except where noted):

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | same as local |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as local |
   | `NEXT_PUBLIC_SITE_URL` | your real Vercel URL, e.g. `https://brand-anchor-studio.vercel.app` — **not** `http://localhost:3000` |
   | `SUPABASE_STORAGE_BUCKET` | `product-assets` |
   | `OPENAI_API_KEY` | same as local |
   | `OPENAI_MODEL` | `gpt-5-mini` |
   | `OPENAI_SPEC_EXTRACTION_ENABLED` | `false` until you've decided to allow a live paid run |
   | `OPENAI_CREATIVE_MODEL` | `gpt-5-mini` |
   | `OPENAI_CREATIVE_DERIVATION_ENABLED` | `false` until decided |
   | `OPENAI_CREATIVE_MAX_ATTEMPTS` | `2` |
   | `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
   | `OPENAI_IMAGE_GENERATION_ENABLED` | `false` until decided |
   | `OPENAI_IMAGE_MAX_ATTEMPTS` | `1` |
   | `DEV_LOGIN_ENABLED` | **do not set this at all in Vercel** — its absence is what keeps the anonymous dev-login route returning 404 in production |

5. Deploy. Once it's live, go back to Supabase → **Authentication → URL
   Configuration** and add the Vercel URL to both **Site URL** and
   **Redirect URLs** (alongside `localhost:3000` if you still want local dev
   to keep working).

## 2. Real email delivery (Resend)

The default Supabase email service is dev-only and low-quota — real invites
need this first.

1. Sign up at resend.com (free tier: 100 emails/day, 3000/month — plenty for
   a 5–10 person Beta).
2. Verify a sending domain (or use Resend's shared test domain if you don't
   have your own domain yet — check current Resend docs for what that
   allows).
3. Create an API key in Resend.
4. In Supabase dashboard: **Project Settings → Authentication → SMTP
   Settings** → enable custom SMTP:
   - Host: `smtp.resend.com`
   - Port: `465` (SSL) or `587` (STARTTLS)
   - Username: `resend`
   - Password: your Resend API key
   - Sender email: an address on your verified domain
5. Send a test invite to yourself first to confirm delivery before inviting
   anyone real.

## 3. Lock down auth before the first external invite

1. Supabase dashboard → **Authentication → Providers**: turn off **Allow
   anonymous sign-ins**.
2. Same page: turn off **Allow new users to sign up** (project-level). The
   app's own invite flow already uses `shouldCreateUser: false`, so this is
   belt-and-suspenders, but SUPABASE_SETUP.md says this was temporarily
   enabled for local dev — turn it back off now.
3. Confirm `DEV_LOGIN_ENABLED` is not set anywhere in the Vercel project's
   environment variables (see step 1.4).
4. To actually invite someone: Supabase dashboard → **Authentication →
   Users → Invite user** (sends a magic link through the SMTP you just
   configured). This is the real mechanism — there's no self-serve signup
   button in the app by design.

## 4. Cost guardrail

OpenAI dashboard → **Settings → Billing → Limits**: set a monthly budget
alert email. This is separate from and in addition to the app's own
`OPENAI_*_ENABLED` flags — those stop *this app* from calling the API by
accident; the billing alert catches anything else on the account.

## 5. First real smoke test

Before inviting anyone: flip the three `OPENAI_*_ENABLED` flags to `true` in
Vercel, run one full cycle yourself against the live deployment (upload →
Spec → campaign → generate → download), confirm it works end to end on the
real URL, then decide whether to leave the flags on for your first invited
users or hand-hold each session initially.
