"use client";

/**
 * Simpanan audio per lagu. localStorage terlalu kecil untuk MP3 beberapa
 * megabita (kuotanya ±5 MB total), jadi audionya tinggal di IndexedDB;
 * metadata lagu tetap di localStorage seperti sebelumnya.
 *
 * Semua fungsi menelan kegagalan. Browser tanpa IndexedDB (beberapa mode
 * privat) tetap bisa memutar lagu yang baru dibuat dari memori — hanya tidak
 * bisa memutarnya lagi setelah halaman ditutup.
 */

const DB_NAME = "jaipong-audio";
const STORE = "tracks";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb tidak tersedia"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
        const request = op(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error ?? new Error("indexeddb"));
      }),
  );
}

export async function putAudio(id: string, blob: Blob): Promise<boolean> {
  try {
    await run("readwrite", (store) => store.put(blob, id));
    return true;
  } catch {
    return false;
  }
}

export async function getAudio(id: string): Promise<Blob | null> {
  try {
    const value = await run<unknown>("readonly", (store) => store.get(id));
    return value instanceof Blob ? value : null;
  } catch {
    return null;
  }
}

/** Hapus tanpa menunggu — dipanggil saat lagu dibuang dari pustaka. */
export function deleteAudio(id: string): void {
  run("readwrite", (store) => store.delete(id)).catch(() => {});
}
