/**
 * Where a chat's files live, and how they come back.
 *
 * Signed in, a file goes straight from the browser into the private
 * `attachments` bucket under `<user id>/chat/`, the same bucket and policies
 * that hold task photos. The server never sees the bytes: the message carries
 * a signed link, and the model fetches it. That is the whole reason there is
 * no cap on how many files a message can carry — the request stays small no
 * matter what is attached.
 *
 * Demo mode has no bucket. Files go into IndexedDB and travel as data URLs,
 * so the host's 4.5 MB request limit applies there and only there.
 */

import { getSupabase } from "@/lib/auth/client";
import { newId } from "@/lib/core/ids";
import { blobToDataUrl, deleteBlob, getBlob, putBlob } from "@/lib/repo/blobs";

import type { ChatFile, ChatFileKind } from "./types";

const BUCKET = "attachments";

/** Supabase's bucket ceiling, set in `supabase/migrations/0006_chat.sql`. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
/** Demo mode sends bytes in the body, so one PDF there must leave room for the rest. */
export const MAX_LOCAL_PDF_BYTES = 2_500_000;
/** Signed links live this long. The model fetches within seconds; the viewer within the hour. */
const SIGNED_TTL_SEC = 2 * 60 * 60;

export interface FileStore {
  kind: "supabase" | "local";
  userId: string;
}

export function fileStoreFor(userId: string, isDemo: boolean): FileStore {
  const supabase = !isDemo && getSupabase();
  return { kind: supabase ? "supabase" : "local", userId };
}

export function isPdfFile(file: File | Blob): boolean {
  if (file.type === "application/pdf") return true;
  const name = "name" in file ? String((file as File).name) : "";
  return /\.pdf$/i.test(name);
}

export interface StoreFileInput {
  kind: ChatFileKind;
  name: string;
  mimeType: string;
  width?: number | undefined;
  height?: number | undefined;
}

function extensionFor(mimeType: string, name: string): string {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/jpeg") return "jpg";
  const fromName = /\.([a-z0-9]{2,4})$/i.exec(name)?.[1];
  return fromName?.toLowerCase() ?? "bin";
}

export async function storeChatFile(
  store: FileStore,
  bytes: Blob,
  meta: StoreFileInput,
): Promise<ChatFile> {
  const id = newId();
  const base = {
    id,
    kind: meta.kind,
    name: meta.name,
    mimeType: meta.mimeType,
    size: bytes.size,
    width: meta.width,
    height: meta.height,
  };

  if (store.kind === "supabase") {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase is not configured.");
    // First path segment is the owner's id: that is what the bucket policy checks.
    const path = `${store.userId}/chat/${id}.${extensionFor(meta.mimeType, meta.name)}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: meta.mimeType, upsert: false });
    if (error) {
      throw new Error(
        /not found|bucket/i.test(error.message)
          ? "File storage is not set up yet. Apply supabase/migrations/0005_attachments.sql."
          : /mime|type/i.test(error.message)
            ? "The bucket does not accept PDFs yet. Apply supabase/migrations/0006_chat.sql."
            : `upload: ${error.message}`,
      );
    }
    return { ...base, ref: `storage:${path}` };
  }

  const key = `${store.userId}:chat:${id}`;
  await putBlob(key, bytes);
  return { ...base, ref: `idb:${key}` };
}

const signed = new Map<string, { url: string; until: number }>();
const objectUrls = new Map<string, string>();

/** A URL an <img> or a link can show. Cached; cheap to call often. */
export async function chatFileUrl(store: FileStore, file: ChatFile): Promise<string> {
  if (file.ref.startsWith("storage:")) {
    const cached = signed.get(file.ref);
    if (cached && cached.until > Date.now()) return cached.url;
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase is not configured.");
    const path = file.ref.slice("storage:".length);
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_TTL_SEC);
    if (error || !data?.signedUrl) throw new Error(`load file: ${error?.message ?? "no url"}`);
    signed.set(file.ref, {
      url: data.signedUrl,
      until: Date.now() + (SIGNED_TTL_SEC - 120) * 1000,
    });
    return data.signedUrl;
  }
  const cached = objectUrls.get(file.ref);
  if (cached) return cached;
  const blob = await getBlob(file.ref.slice("idb:".length));
  if (!blob) throw new Error("That file is no longer stored on this device.");
  const url = URL.createObjectURL(blob);
  objectUrls.set(file.ref, url);
  return url;
}

/**
 * The URL the server passes to the model. A signed link for Storage; the
 * bytes themselves, as a data URL, for a file that only exists on this device.
 */
export async function chatFileWireUrl(store: FileStore, file: ChatFile): Promise<string> {
  if (file.ref.startsWith("storage:")) return chatFileUrl(store, file);
  const blob = await getBlob(file.ref.slice("idb:".length));
  if (!blob) throw new Error(`"${file.name}" is no longer stored on this device.`);
  return blobToDataUrl(blob);
}

export async function deleteChatFile(store: FileStore, file: ChatFile): Promise<void> {
  if (file.ref.startsWith("storage:")) {
    signed.delete(file.ref);
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.storage.from(BUCKET).remove([file.ref.slice("storage:".length)]);
    return;
  }
  const url = objectUrls.get(file.ref);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(file.ref);
  }
  await deleteBlob(file.ref.slice("idb:".length)).catch(() => undefined);
}

/** Base64 from the model → bytes to store. */
export function base64ToBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
