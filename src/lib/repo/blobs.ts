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

/**
 * The most one prepared image may weigh.
 *
 * Images travel to the server as base64 inside a JSON body, and Vercel
 * refuses any body over 4.5 MB with a bare 413 before the app sees it. Four
 * images at this size, base64-inflated by a third, fit under the server's own
 * 4 MB ceiling with room for the text. A 1600px JPEG of a worksheet or a
 * screenshot is well under this; the budget only bites on a PNG of
 * photo-like content, which is exactly where PNG is the wrong choice.
 */
export const MAX_IMAGE_BYTES = 700_000;
export const MAX_IMAGES = 4;
/** Total data-URL characters one capture may carry. Mirrors `CaptureRequestSchema`. */
export const MAX_UPLOAD_CHARS = 4_000_000;

/**
 * How an image is tried, in order, until one encoding fits the budget. The
 * first step keeps PNG so a screenshot's text stays crisp; after that, each
 * step trades a little quality or size for bytes. The last step always fits.
 */
export interface EncodeStep {
  maxEdge: number;
  mimeType: "image/png" | "image/jpeg";
  quality?: number;
}

export function encodingSteps(sourceType: string): EncodeStep[] {
  const steps: EncodeStep[] = [];
  if (sourceType === "image/png") steps.push({ maxEdge: 1600, mimeType: "image/png" });
  steps.push(
    { maxEdge: 1600, mimeType: "image/jpeg", quality: 0.8 },
    { maxEdge: 1600, mimeType: "image/jpeg", quality: 0.65 },
    { maxEdge: 1280, mimeType: "image/jpeg", quality: 0.65 },
    { maxEdge: 1024, mimeType: "image/jpeg", quality: 0.6 },
    { maxEdge: 800, mimeType: "image/jpeg", quality: 0.5 },
  );
  return steps;
}

export function isImageFile(file: File | Blob): boolean {
  if (/^image\/(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i.test(file.type)) return true;
  // Finder and Photos sometimes hand over a HEIC with an empty type.
  const name = "name" in file ? String((file as File).name) : "";
  return /\.(heic|heif)$/i.test(name);
}

function isHeic(file: File | Blob): boolean {
  if (/^image\/hei[cf]$/i.test(file.type)) return true;
  const name = "name" in file ? String((file as File).name) : "";
  return /\.(heic|heif)$/i.test(name);
}

/**
 * Decode, downscale and re-encode so the result fits `MAX_IMAGE_BYTES`.
 * Keeps PNG for screenshots when it is cheap enough (text stays crisp) and
 * falls back to JPEG, then to smaller JPEGs, for everything else.
 */
export async function prepareImage(file: File | Blob, name = "image"): Promise<PreparedImage> {
  const source = isHeic(file) ? await convertHeic(file) : file;
  const bitmap = await decode(source);
  try {
    let last: PreparedImage | undefined;
    for (const step of encodingSteps(source.type)) {
      last = await encode(bitmap, step, name);
      if (last.blob.size <= MAX_IMAGE_BYTES) return last;
    }
    if (!last) throw new Error("Could not prepare the image.");
    return last;
  } finally {
    if ("close" in bitmap) bitmap.close();
  }
}

async function encode(
  bitmap: ImageBitmap | HTMLImageElement,
  step: EncodeStep,
  name: string,
): Promise<PreparedImage> {
  const sourceWidth = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
  const sourceHeight = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, step.maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the image.");
  if (step.mimeType === "image/jpeg") {
    // JPEG has no alpha; a transparent screenshot would otherwise go black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("Could not encode the image."))),
      step.mimeType,
      step.quality,
    );
  });
  const extension = step.mimeType === "image/png" ? ".png" : ".jpg";
  const safeName = name.replace(/\.[a-z0-9]+$/i, "") + extension;
  return { blob, width, height, mimeType: step.mimeType, name: safeName };
}

/**
 * iPhone photos arrive as HEIC, which Chrome cannot decode. The converter is
 * a sizeable chunk and is only fetched the first time one shows up.
 */
async function convertHeic(file: Blob): Promise<Blob> {
  try {
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    return Array.isArray(out) ? (out[0] as Blob) : (out as Blob);
  } catch {
    throw new Error(
      "That HEIC photo could not be converted. In Photos, export it as JPEG and try again.",
    );
  }
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
