import { z } from "zod";
import {
  DraftSchema,
  emptyWorkspace,
  draftHash,
  validateForRender,
  demoProvider,
  DEMO_PROVIDER,
  type Workspace,
  canonicalDraft,
} from "./workflow.ts";
export interface WorkspaceStore {
  read(owner: string): Promise<{ workspace: Workspace; etag: string | null }>;
  compareAndSet(
    owner: string,
    expectedEtag: string | null,
    workspace: Workspace,
  ): Promise<boolean>;
}
const WriteSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    draft: DraftSchema,
    intent: z.enum(["save", "confirm", "reset", "restore"]),
    restoreVersionId: z.string().uuid().optional(),
  })
  .strict();
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
async function boundedJson(request: Request) {
  if (Number(request.headers.get("content-length")) > 1_600_000)
    throw new Error("Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body.");
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_600_000) {
        await reader.cancel();
        throw new Error("Request is too large.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
}
export async function handleDemoRequest(
  request: Request,
  owner: string | null,
  store: WorkspaceStore,
): Promise<Response> {
  if (!owner)
    return json({ error: "Sign in to open your private workspace." }, 401);
  const url = new URL(request.url);
  const route = url.pathname.replace(/\/$/, "");
  if (!route.startsWith("/api/demo/")) return json({ error: "Not found" }, 404);
  if (!["GET", "PUT", "POST"].includes(request.method))
    return json({ error: "Method not allowed" }, 405);
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin)
      return json({ error: "Cross-origin writes are not allowed." }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "Use application/json." }, 415);
  }
  try {
    if (route === "/api/demo/workspace" && request.method === "GET") {
      const { workspace } = await store.read(owner);
      return json({ ...workspace, provider: DEMO_PROVIDER, aiCostMicros: 0 });
    }
    if (route === "/api/demo/directions" && request.method === "POST") {
      const draft = DraftSchema.parse(await boundedJson(request));
      return json({
        directions: await demoProvider.directions(draft),
        provider: DEMO_PROVIDER,
        aiCostMicros: 0,
      });
    }
    if (route === "/api/demo/storyboard" && request.method === "POST") {
      const input = z
        .object({
          draft: DraftSchema,
          direction: z.enum(["scenario", "proof", "detail"]),
        })
        .parse(await boundedJson(request));
      return json({
        draft: await demoProvider.storyboard(input.draft, input.direction),
        provider: DEMO_PROVIDER,
        aiCostMicros: 0,
      });
    }
    if (route === "/api/demo/workspace" && request.method === "PUT") {
      const input = WriteSchema.parse(await boundedJson(request));
      const { workspace: old, etag } = await store.read(owner);
      if (old.revision !== input.expectedRevision)
        return json(
          {
            error:
              "This project changed in another tab. Reload the saved project before continuing.",
          },
          409,
        );
      if (
        input.intent === "reset" &&
        (input.draft.shots.length || input.draft.selectedDirection !== null)
      )
        return json({ error: "Reset must start a new storyboard." }, 400);
      if (input.intent === "restore") {
        const source = old.versions.find(
          (v) => v.id === input.restoreVersionId,
        );
        if (
          !source ||
          canonicalDraft(source.draft) !== canonicalDraft(input.draft)
        )
          return json(
            { error: "Choose a saved version from this workspace to restore." },
            400,
          );
      }
      for (const oldShot of old.draft?.shots ?? []) {
        const nextShot = input.draft.shots.find((s) => s.id === oldShot.id);
        if (
          oldShot.locked &&
          !nextShot &&
          !["reset", "restore"].includes(input.intent)
        )
          return json(
            {
              error:
                "Unlock the shot before removing it, or explicitly restore/reset the storyboard.",
            },
            422,
          );
        if (
          !["reset", "restore"].includes(input.intent) &&
          oldShot.locked &&
          nextShot?.locked &&
          (JSON.stringify(oldShot) !== JSON.stringify(nextShot) ||
            old.draft?.imageDataUrl !== input.draft.imageDataUrl)
        )
          return json(
            {
              error:
                "Unlock the affected shot before changing its content or product reference.",
            },
            422,
          );
      }
      const draft = { ...input.draft, scriptConfirmed: false };
      const versions = [...old.versions];
      const hash = await draftHash(draft);
      if (input.intent === "confirm") {
        validateForRender(draft);
        const latest = versions.at(-1);
        if (latest?.hash !== hash) {
          if (versions.length >= 12)
            return json(
              {
                error:
                  "The demo keeps up to 12 confirmed versions. Export this project before continuing.",
              },
              422,
            );
          versions.push({
            id: crypto.randomUUID(),
            version: versions.length + 1,
            createdAt: new Date().toISOString(),
            hash,
            draft: { ...draft, scriptConfirmed: true },
          });
        }
        draft.scriptConfirmed = true;
      } else if (input.intent !== "restore" && versions.at(-1)?.hash === hash) {
        draft.scriptConfirmed = true;
      }
      const next = { revision: old.revision + 1, draft, versions };
      if (!(await store.compareAndSet(owner, etag, next)))
        return json(
          {
            error:
              "A simultaneous save was detected. Reload the saved project.",
          },
          409,
        );
      return json({ ...next, provider: DEMO_PROVIDER, aiCostMicros: 0 });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        {
          error: error.issues
            .map((x) => `${x.path.join(".")}: ${x.message}`)
            .join("; "),
        },
        400,
      );
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not complete the request.",
      },
      400,
    );
  }
}
export { emptyWorkspace };
