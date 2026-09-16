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
        const request = op(tx.objectStore(STORE));
        let result: T | undefined;
        request.onsuccess = () => {
          result = request.result as T;
        };
        const fail = () => reject(tx.error ?? request.error ?? new Error("indexeddb"));
        // Diselesaikan saat transaksinya benar-benar commit, bukan saat
        // request-nya sukses: penyimpanan yang penuh baru ketahuan di sini pada
        // sebagian browser, dan putAudio jangan sampai melapor "tersimpan" untuk
        // audio yang sebenarnya dibuang.
        tx.oncomplete = () => {
          db.close();
          resolve(result as T);
        };
        tx.onabort = () => {
          db.close();
          fail();
        };
        tx.onerror = fail;
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
