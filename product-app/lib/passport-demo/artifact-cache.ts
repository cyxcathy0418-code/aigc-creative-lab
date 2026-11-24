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
