# Creative Passport — First Working Demo

This release follows the Creative Passport PRD and delivers a deployed workflow before the remaining product capabilities. No paid model tests were performed for this release.

## Workflow

One product in US/en-US or MX/es-MX:

Product image and brief → human confirmation of source-backed facts → three creative hypotheses → selection and editing of a four-shot storyboard → confirmation → actual 15-second vertical MP4 encoding → local revisions, saved versions, and MP4 / SRT / preview-package export.

The initial creative provider uses explicitly labeled templates. Default videos are silent with captions; users may upload narration they have the right to use. Overlong audio must be corrected. Provider interfaces remain available for later model integration, and current model spend is $0.00.

## Implementation boundaries

- The existing Next.js / Supabase application and foundation schema are preserved. `/demo` is an additional entry point; legacy `campaigns` records remain creative batches.
- The Next.js page and hosted demo share the React workspace, schemas, creative service, and media modules. The separate hosting entry point adapts HTTP and storage rather than duplicating business logic.
- The hosted backend uses a Worker, Sites authentication, stable user IDs, and private R2 storage for projects and immutable confirmed versions. Conflicting saves return HTTP 409.
- WebCodecs and Mediabunny encode an actual H.264 MP4 in the browser. Keep the page open until encoding finishes. Persistent server-side rendering jobs are a future production capability.
- Product images are saved with the private project. Video blobs are cached in device-local IndexedDB and can be recreated from saved scripts and images. Cross-device cloud video synchronization is a separate capability.
- The local development server uses a single-process file-store adapter. It does not write into the original production Supabase project. Ordinary Next.js requests must not trust the hosted adapter's identity header.
- Supabase email invitations, full cost reservations, advertising-draft screens, and external feedback remain part of the broader PRD. Exported demo packages are marked as internal previews pending human review.

## Acceptance criteria

1. Storyboards can use only sourced, human-confirmed facts. Directions are labeled hypotheses rather than assumptions about national preferences.
2. Export a real 15-second, 9:16, 1080 × 1920, 30 fps video and downloadable captions. Caption overflow and overlong narration block export.
3. Edits require reconfirmation. Previous versions remain intact; locked shots preserve their contents and asset references.
4. Reload restores the project and script from the backend. Concurrent saves do not silently overwrite data, and ownership is checked on every request.
5. Deploy the frontend and backend, verify the online result, and perform no paid model calls or simulated advertising-performance reporting.

## Implemented

- Shared schemas, provider interfaces, server-side persistence, and workflow checks.
- Bilingual workspace, facts / directions / storyboard / history interactions, and actual media encoding.
- Shared Next.js and standalone hosting adapters, browser workflow verification, deployment, and source synchronization.

## Verification

An actual MP4 was rendered and inspected as 15 seconds at 1080 × 1920. The preview ZIP contained the video, SRT, script manifest, and demo disclosure. Reload restored both the project and the local video cache.

Review fixes covered captured fact evidence, confirmation of incomplete facts, cache-recovery ordering, preservation of custom copy across market switches, and explicit reset / restore rules for locked shots.

On November 25, 2026, online Chrome verification covered creator login, fact confirmation, three directions, four-shot storyboard creation, confirmed version saving, restoration after reload, video encoding, and MP4 download. The downloaded file was 4,073,063 bytes, 15 seconds, and 1080 × 1920. The browser automation's download-event wait timed out, but the downloaded file was independently verified; no corresponding product download failure was found.

The existing suite passed all 64 automated checks, and the production build succeeded. English / Chinese switching, preference persistence, retention of the original script and shot locks, history / about pages, and a 390 px-wide layout were checked in the browser. The deployed Chinese interface restored its saved version and cached video after reload.

No paid provider was tested. The original paused Supabase project was not resumed or modified. The local file-store adapter is for single-process development; it is not a substitute for hosted authentication or database verification. The legacy LoginForm retains a navigation lint warning.

## Language and visual design

The top-right EN / Chinese button switches interface language and remembers the preference in the current browser. Navigation, workflow steps, notices, and history are localized. Switching interface language does not translate or rewrite product facts, advertising copy, uploaded narration, or saved versions. Advertising language follows the target market.

The workspace uses a dark evergreen sidebar, light editing surfaces, clear typography, and responsive layouts.

## Run and deploy

Live creator-only workspace: https://creative-passport-cathy-demo.cyxcathy0418.chatgpt.site

Use the creator's ChatGPT account for the initial sign-in. The current application source is on `feature/creative-passport`; the Next.js entry point is `/demo`.

From `product-app`:

```bash
npm ci
npm run demo:build
npm run demo:dev
```

Local URL: `http://127.0.0.1:4173`.

Prepare an independent hosting checkout with:

```bash
npm run demo:prepare -- /absolute/path/to/site-checkout
```

This copies shared frontend and backend source without changing the main repository's Git remote. The Site identity is retained in `demo-host/.openai/hosting.json`; updates reuse that identity rather than creating a new Site. Environment files, runtime records, and credentials are not copied.

The deployed workspace supports creator-led demonstrations. Interviewers currently cannot access it with the link alone; independent trial access needs an explicit visitor or application-auth configuration.

Project inputs and versions are backend-persisted. Video files remain cached on the generating device and should be downloaded promptly. If device storage is full, cache recovery may fail; the saved image and storyboard still allow the video to be recreated.
