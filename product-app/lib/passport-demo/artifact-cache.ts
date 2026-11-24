import { draftHash, type Workspace } from "./workflow.ts";
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("creative-passport-demo", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("videos");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function cacheVideo(key: string, blob: Blob) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("videos", "readwrite");
      tx.objectStore("videos").put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function cachedVideo(key: string): Promise<Blob | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("videos").objectStore("videos").get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function recoverWorkspace(
  load: () => Promise<Workspace>,
  readVideo: (key: string) => Promise<Blob | null>,
) {
  const workspace = await load();
  let video: Blob | null = null,
    videoHash: string | null = null;
  const snapshot = workspace.versions.at(-1);
  if (
    workspace.draft?.scriptConfirmed &&
    snapshot &&
    (await draftHash(workspace.draft)) === snapshot.hash
  ) {
    try {
      video = await readVideo(`${workspace.draft.id}:${snapshot.hash}`);
      if (video) videoHash = snapshot.hash;
    } catch {
      /* Saved inputs remain usable if device cache is unavailable. */
    }
  }
  return { workspace, video, videoHash };
}
