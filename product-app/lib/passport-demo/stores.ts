import { emptyWorkspace, type Workspace } from "./workflow.ts";
import type { WorkspaceStore } from "./service.ts";
export interface ObjectBucket {
  get(key: string): Promise<{ etag: string; json<T>(): Promise<T> } | null>;
  put(
    key: string,
    value: string,
    options: {
      onlyIf: { etagMatches?: string; etagDoesNotMatch?: string };
      httpMetadata: { contentType: string };
    },
  ): Promise<unknown | null>;
}
export async function ownerKey(owner: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(owner),
  );
  return `passport-demo/v1/${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}.json`;
}
export class R2WorkspaceStore implements WorkspaceStore {
  bucket: ObjectBucket;
  constructor(bucket: ObjectBucket) {
    this.bucket = bucket;
  }
  async read(owner: string) {
    const object = await this.bucket.get(await ownerKey(owner));
    return object
      ? { workspace: await object.json<Workspace>(), etag: object.etag }
      : { workspace: emptyWorkspace(), etag: null };
  }
  async compareAndSet(
    owner: string,
    etag: string | null,
    workspace: Workspace,
  ) {
    return (
      (await this.bucket.put(await ownerKey(owner), JSON.stringify(workspace), {
        onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
      })) !== null
    );
  }
}
