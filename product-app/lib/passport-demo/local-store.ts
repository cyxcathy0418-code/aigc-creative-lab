import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { emptyWorkspace, type Workspace } from "./workflow.ts";
import type { WorkspaceStore } from "./service.ts";
import { ownerKey } from "./stores.ts";
const locks = new Map<string, Promise<void>>();
export class LocalWorkspaceStore implements WorkspaceStore {
  directory: string;
  constructor(directory = path.resolve(".passport-demo")) {
    this.directory = directory;
  }
  async file(owner: string) {
    return path.join(
      this.directory,
      (await ownerKey(owner)).split("/").at(-1)!,
    );
  }
  async read(owner: string) {
    try {
      return JSON.parse(await readFile(await this.file(owner), "utf8")) as {
        workspace: Workspace;
        etag: string;
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return { workspace: emptyWorkspace(), etag: null };
      throw e;
    }
  }
  async compareAndSet(
    owner: string,
    etag: string | null,
    workspace: Workspace,
  ) {
    const key = await this.file(owner);
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(key, wait);
    await previous;
    try {
      if ((await this.read(owner)).etag !== etag) return false;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${key}.${crypto.randomUUID()}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({ workspace, etag: crypto.randomUUID() }),
        { mode: 0o600 },
      );
      await rename(temporary, key);
      return true;
    } finally {
      release();
      if (locks.get(key) === wait) locks.delete(key);
    }
  }
}
