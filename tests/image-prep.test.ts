/**
 * Images must arrive at the server at a size it will take.
 *
 * The first production bug with attachments was a retina screenshot that
 * stayed PNG at 5 MB, left the browser as 7 MB of base64 and met the host's
 * 4.5 MB body limit as a bare 413. These pin the budget that prevents it and
 * tie the client's numbers to the server's schema so they cannot drift apart.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_CHARS,
  encodingSteps,
  isImageFile,
} from "@/lib/repo/blobs";
import { CaptureRequestSchema, ImageDataUrlSchema } from "@/server/schemas";

function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

describe("encoding steps", () => {
  it("keeps PNG only as a first try for a PNG source, then gets smaller", () => {
    const png = encodingSteps("image/png");
    expect(png[0]).toMatchObject({ mimeType: "image/png", maxEdge: 1600 });
    expect(png.slice(1).every((s) => s.mimeType === "image/jpeg")).toBe(true);
    for (let i = 1; i < png.length; i += 1) {
      expect(png[i]!.maxEdge).toBeLessThanOrEqual(png[i - 1]!.maxEdge);
    }
    expect(png.length).toBeGreaterThanOrEqual(4);
  });

  it("never tries PNG for a photo", () => {
    expect(encodingSteps("image/jpeg").every((s) => s.mimeType === "image/jpeg")).toBe(true);
    expect(encodingSteps("image/heic").every((s) => s.mimeType === "image/jpeg")).toBe(true);
  });
});

describe("the budget fits the server", () => {
  it("accepts the largest capture the client can produce", () => {
    const one = "data:image/jpeg;base64," + "A".repeat(base64Length(MAX_IMAGE_BYTES));
    expect(ImageDataUrlSchema.safeParse(one).success).toBe(true);
    const request = CaptureRequestSchema.safeParse({
      text: "",
      images: Array.from({ length: MAX_IMAGES }, () => one),
      clientId: "client-12345678",
    });
    expect(request.success).toBe(true);
    expect(one.length * MAX_IMAGES).toBeLessThanOrEqual(MAX_UPLOAD_CHARS);
  });

  it("stays under the host's 4.5 MB body limit with the text on top", () => {
    expect(MAX_UPLOAD_CHARS + 8000 + 4096).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe("isImageFile", () => {
  it("takes HEIC by name when the type is empty, and refuses documents", () => {
    expect(isImageFile(new File([""], "IMG_0001.HEIC", { type: "" }))).toBe(true);
    expect(isImageFile(new File([""], "photo.jpg", { type: "image/jpeg" }))).toBe(true);
    expect(isImageFile(new File([""], "sheet.pdf", { type: "application/pdf" }))).toBe(false);
  });
});
