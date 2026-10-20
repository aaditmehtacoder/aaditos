/**
 * Image bytes for the local repository.
 *
 * `localStorage` is the wrong place for photos: a 5 MB quota is three
 * whiteboard pictures. IndexedDB holds blobs natively and has a quota in the
 * hundreds of megabytes, so the local and demo workspaces keep their images
 * here, keyed by attachment id, and the workspace record only carries the key.
 *
 * Also the client-side preparation step every image goes through before it
 * is stored or sent to the model: decode, downscale to a sensible edge, and
 * re-encode as JPEG. A 12-megapixel phone photo becomes ~150 KB and is still
 * perfectly legible as a photo of an assignment sheet.
 */

const DB_NAME = "aaditos-blobs";
const STORE = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await tx("readwrite", (store) => store.put(blob, key));
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const value = await tx<unknown>("readonly", (store) => store.get(key));
  return value instanceof Blob ? value : undefined;
}

export async function deleteBlob(key: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(key));
}

export async function clearBlobsWithPrefix(prefix: string): Promise<void> {
  const keys = await tx<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
  await Promise.all(
    keys
      .filter((k): k is string => typeof k === "string" && k.startsWith(prefix))
      .map((k) => deleteBlob(k)),
  );
}

// ---- preparation ----------------------------------------------------------

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  name: string;
}

/** Longest edge after downscaling. Legible for text, small enough to send. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

export function isImageFile(file: File | Blob): boolean {
  return /^image\/(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(file.type);
}

/**
 * Decode, downscale and re-encode. Keeps PNG for screenshots (text stays
 * crisp) and uses JPEG for everything else (photos compress far better).
 */
export async function prepareImage(file: File | Blob, name = "image"): Promise<PreparedImage> {
  const bitmap = await decode(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap) bitmap.close();

  const png = file.type === "image/png" && width * height < 2_200_000;
  const mimeType = png ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("Could not encode the image."))),
      mimeType,
      png ? undefined : JPEG_QUALITY,
    );
  });
  const safeName = name.replace(/\.[a-z0-9]+$/i, "") + (png ? ".png" : ".jpg");
  return { blob, width, height, mimeType, name: safeName };
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img>, which handles a few formats bitmap does not */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not an image this browser can read."));
    };
    img.src = url;
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.readAsDataURL(blob);
  });
}
