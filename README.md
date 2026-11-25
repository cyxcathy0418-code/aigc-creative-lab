# Creative Passport · AIGC Creative Lab

A multilingual advertising creative workspace for cross-border brands and merchants. Creative Passport connects product information, source-backed facts, creative directions, storyboards, short-video production, revision history, and asset export in one workflow.

**[Open the deployed workspace](https://creative-passport-cathy-demo.cyxcathy0418.chatgpt.site)** · **[Current product source](https://github.com/cyxcathy0418-code/aigc-creative-lab/tree/feature/creative-passport)** · **[Product guide](https://github.com/cyxcathy0418-code/aigc-creative-lab/blob/feature/creative-passport/product-app/README.md)**

The deployed workspace currently requires the creator's ChatGPT account. The current Creative Passport implementation is on `feature/creative-passport`; `main` retains the earlier application and Python lab. The live demo uses explicitly labeled creative templates and makes no paid model calls.

## Product workflow

Product image and brief → confirm facts and sources → explore three directions → edit and confirm a four-shot storyboard → render a 15-second vertical video → revise and export.

- English and Chinese interface switching, independent of the advertising language.
- United States / English and Mexico / Spanish market contexts.
- Source-backed product claims, human confirmation, and evidence tied to individual shots.
- Editable captions, shot locking, and immutable confirmed versions.
- Actual 1080 × 1920 H.264 MP4 encoding at 30 fps, with SRT and preview-package downloads.
- Private backend storage for projects and versions, plus device-local video caching.
- Separate Campaign → Ad Group → Ad draft foundations; creative batches are not advertising Campaigns.

## Architecture

| Area | Technology and responsibility |
|---|---|
| Product interface | React, TypeScript, and an English / Chinese interface |
| Shared workflow | Zod schemas, source and evidence checks, and version validation |
| Deployed demo backend | Cloudflare Worker and private R2 project storage through Sites |
| Media production | Canvas, WebCodecs, Mediabunny, and SRT / ZIP export |
| Existing application | Next.js and Supabase authentication, database, and private storage foundations |
| Original experimentation lab | Python, Pydantic, Streamlit, LangGraph, and optional LangSmith tracing |

Pydantic remains part of the Python lab. The web product uses TypeScript and Zod so its interface and backend can share workflow contracts. The demo hosting adapter and the Next.js `/demo` entry point use the same core modules.

## Run Creative Passport locally

Requirements: Git and Node.js 22.13 or newer.

```bash
git clone https://github.com/cyxcathy0418-code/aigc-creative-lab.git
cd aigc-creative-lab
git checkout feature/creative-passport
cd product-app
npm ci
npm run demo:build
npm run demo:dev
```

Open `http://127.0.0.1:4173`. This standalone local demo uses a development-only file store and does not require model credentials. Its local session is not a production authentication method.

For the existing Next.js / Supabase application, see the [product guide](https://github.com/cyxcathy0418-code/aigc-creative-lab/blob/feature/creative-passport/product-app/README.md). See the [demo scope and hosting notes](https://github.com/cyxcathy0418-code/aigc-creative-lab/blob/feature/creative-passport/product-app/docs/DEMO_V1.md) for deployment and storage boundaries.

## Original Python / Streamlit lab

The original Brand Anchor Studio lab studies product identity drift in advertising images: colors, silhouette, components, and brand markings can change across markets and generations. It extracts a structured product Spec and deterministically inserts the confirmed visual anchor into generation prompts.

This lab is separate from the deployed Creative Passport workflow. Its controlled image experiments and historical verification records do not establish the quality or advertising performance of the new product.

### Install dependencies

Use Python with an isolated virtual environment:

```bash
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Configure environment variables

Create a local `.env` in the repository root. Never commit credentials.

```env
OPENAI_API_KEY=your_openai_api_key
```

Optional configuration:

```env
OPENAI_MODEL=gpt-4o
OPENAI_IMAGE_MODEL=gpt-image-2-2026-04-21
OPENAI_JUDGE_MODEL=gpt-4o
OPENAI_REQUEST_TIMEOUT=60
SPEC_MAX_RETRIES=3
LANGSMITH_API_KEY=your_langsmith_api_key
LANGSMITH_PROJECT=aigc-creative-lab-spec
```

These are the legacy lab configuration examples, not recommendations for the next Creative Passport model integration. Model availability depends on the provider and account. Tracing is enabled only when `LANGSMITH_API_KEY` is configured; the lab also runs without it.

### Run the lab

```bash
python -m streamlit run app.py
```

On Windows, `run_app.bat` can also launch the application. Keep its console window open and visit `http://localhost:8501`.

1. Upload one to three product images.
2. Enter the product name, selling points, brand tone, markets, platform, and visual style.
3. Generate a Spec, review its fields, and confirm it. The confirmed Spec is stored in `st.session_state["confirmed_spec"]`.
4. Select markets and generate market creatives.
5. Review localized hooks, CTAs, 15-second storyboards, and image / video prompts; export the JSON if needed.
6. For a controlled image experiment, select at least two markets, choose the reference, size, and quality, and explicitly confirm paid calls.
7. Review generated images and blind scores, enter human review results, and download the experiment package.

### Input guidance

- **Selling points:** supported functions, benefits, and purchase reasons. Do not invent features or performance claims.
- **Brand tone:** the brand's longer-term voice and character.
- **Visual style:** the creative direction for this production; it is distinct from product identity and selling points.
- Keep each product image below 10 MB to reduce upload and request failures.

### Market creative derivation

- The legacy market options are the United States, Europe, Japan, Korea, and Southeast Asia. The newer web foundation normalizes country and locale data separately; regional legacy records are not silently assigned to countries.
- Each creative contains three or four shots totaling 15 seconds, with a hook in the first three seconds.
- Each prompt provides a controlled pair: a Bare Prompt with the product name, category, and market creative direction, and an Anchored Prompt with the same direction plus the confirmed anchor sentence, colors, materials, silhouette, logo, distinctive details, and visual constraints.
- Keep market, platform, style, model, dimensions, quality, and seed (where supported) fixed when comparing the pair. The anchor block is the intended variable.
- Prompt references identify the Spec fields used. Selling-point claims must stay within the confirmed `selling_points`.
- Reconfirming the Spec or changing markets, platform, or style invalidates prior market creatives.

### Controlled image experiments

- Arm A uses the product name, category, and market direction. Arm B adds the complete `anchor_block` to the same direction.
- The control is checked for leaked visual-anchor attributes before generation.
- Both arms use the same image-model snapshot, size, and quality, with one image per market per arm. Product reference images are used for review, not as generation inputs in this experiment.
- The LLM judge receives randomized Candidate X/Y labels without prompts, arm labels, or the hypothesis.
- Color, logo, material, silhouette / proportions, and distinctive components are scored from 0 to 5; the overall mean is calculated by code.
- Successful images and scores are cached by experiment fingerprint. Retrying a partial failure reuses completed results.
- Changes to the Spec, source images, context, prompts, model, size, or quality invalidate the current results.
- Artifacts are written under the Git-ignored `artifacts/ab_experiments/<experiment_id>/`. Exported ZIP files contain references, generated images, and the manifest.
- Small-sample observations do not establish statistical significance or advertising performance.

### Debugging

- The lab records input summaries, raw model output, parsed results, and validation errors for troubleshooting.
- Images are logged as file names, MIME types, and sizes, without base64 payloads. API keys are not printed.
- Extraction and derivation use bounded retries for failed calls, timeouts, invalid JSON, and schema errors, with at most three attempts.
- The `.env` file is ignored by Git.

To exercise malformed-output handling, temporarily set:

```env
LLM_PROVIDER=mock_bad_json
```

Generate a Spec to observe the bounded failure flow. Restore normal operation afterward:

```env
LLM_PROVIDER=openai
```
