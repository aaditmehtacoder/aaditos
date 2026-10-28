// @vitest-environment node
/**
 * The chat as it crosses the wire: files as links, the schema that admits
 * them, the host check that keeps the model fetching only our bucket, and
 * the runtime's handling of the painter.
 */

import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classify } from "@/server/ai";
import {
  HISTORY_WINDOW,
  imageTool,
  isImageModelFailure,
  pictureUnavailableMessage,
  systemInstructions,
  toInputItems,
} from "@/server/compass-runtime";
import { CompassMessageSchema, CompassRequestSchema, attachmentUrlAllowed } from "@/server/schemas";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env["OPENAI_API_KEY"] = "sk-test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

const STORAGE = "https://jzouelcjnopyykzfkapy.supabase.co";
const signed = (name: string) =>
  `${STORAGE}/storage/v1/object/sign/attachments/u1/chat/${name}?token=abc`;
const tinyPng = `data:image/png;base64,${"A".repeat(40)}`;
const tinyPdf = `data:application/pdf;base64,${"B".repeat(40)}`;

describe("toInputItems", () => {
  it("keeps a plain exchange as plain messages", () => {
    expect(
      toInputItems([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ]),
    ).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("turns files into image and file parts, by link", () => {
    const [item] = toInputItems([
      {
        role: "user",
        content: "what is this?",
        attachments: [
          { kind: "image", name: "sheet.jpg", url: signed("a.jpg") },
          { kind: "pdf", name: "syllabus", url: signed("b.pdf") },
        ],
      },
    ]);
    expect(item).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "what is this?" },
        { type: "input_image", image_url: signed("a.jpg"), detail: "auto" },
        { type: "input_file", file_url: signed("b.pdf") },
      ],
    });
  });

  it("sends demo-mode bytes as file_data and supplies text when there is none", () => {
    const [item] = toInputItems([
      { role: "user", content: "   ", attachments: [{ kind: "pdf", name: "x.pdf", url: tinyPdf }] },
    ]);
    expect(item).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "See the attached files." },
        { type: "input_file", filename: "x.pdf", file_data: tinyPdf },
      ],
    });
  });

  it("keeps only the last window of history, files included", () => {
    const messages = Array.from({ length: HISTORY_WINDOW + 5 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`,
    }));
    const items = toInputItems(messages);
    expect(items).toHaveLength(HISTORY_WINDOW);
    expect(items[0]).toEqual({ role: "assistant", content: "m5" });
  });
});

describe("attachmentUrlAllowed", () => {
  it("accepts a signed link into our own bucket", () => {
    expect(attachmentUrlAllowed(signed("a.jpg"), STORAGE)).toBe(true);
  });

  it("accepts data URLs, which carry their own bytes", () => {
    expect(attachmentUrlAllowed(tinyPng, STORAGE)).toBe(true);
    expect(attachmentUrlAllowed(tinyPng, undefined)).toBe(true);
  });

  it("refuses other hosts, other buckets, the public path, and plain http", () => {
    expect(attachmentUrlAllowed("https://evil.example/x.jpg", STORAGE)).toBe(false);
    expect(
      attachmentUrlAllowed(`${STORAGE}/storage/v1/object/sign/other/u1/a.jpg?token=x`, STORAGE),
    ).toBe(false);
    expect(
      attachmentUrlAllowed(`${STORAGE}/storage/v1/object/public/attachments/u1/a.jpg`, STORAGE),
    ).toBe(false);
    expect(attachmentUrlAllowed(signed("a.jpg").replace("https:", "http:"), STORAGE)).toBe(false);
  });

  it("refuses every link when no storage host is configured", () => {
    expect(attachmentUrlAllowed(signed("a.jpg"), undefined)).toBe(false);
  });
});

describe("CompassMessageSchema with files", () => {
  it("accepts a message that is only files", () => {
    const parsed = CompassMessageSchema.safeParse({
      role: "user",
      content: "",
      attachments: [{ kind: "image", name: "a.jpg", url: signed("a.jpg") }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a message with neither text nor files", () => {
    expect(CompassMessageSchema.safeParse({ role: "user", content: "  " }).success).toBe(false);
  });

  it("accepts a pasted essay, and rejects one past the ceiling", () => {
    expect(
      CompassMessageSchema.safeParse({ role: "user", content: "x".repeat(16_000) }).success,
    ).toBe(true);
    expect(
      CompassMessageSchema.safeParse({ role: "user", content: "x".repeat(16_001) }).success,
    ).toBe(false);
  });

  it("takes many files on one message", () => {
    const attachments = Array.from({ length: 40 }, (_, i) => ({
      kind: "image" as const,
      name: `p${i}.jpg`,
      url: signed(`p${i}.jpg`),
    }));
    expect(CompassMessageSchema.safeParse({ role: "user", content: "", attachments }).success).toBe(
      true,
    );
  });

  it("rejects a PDF data URL pretending to be an image, and a javascript: link", () => {
    expect(
      CompassMessageSchema.safeParse({
        role: "user",
        content: "",
        attachments: [{ kind: "image", name: "a", url: tinyPdf }],
      }).success,
    ).toBe(false);
    expect(
      CompassMessageSchema.safeParse({
        role: "user",
        content: "",
        attachments: [{ kind: "image", name: "a", url: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
  });

  it("caps the bytes demo mode may carry in one request", () => {
    const big = `data:image/png;base64,${"A".repeat(1_500_000)}`;
    const request = {
      messages: [
        {
          role: "user",
          content: "",
          attachments: [1, 2, 3].map((i) => ({ kind: "image", name: `p${i}`, url: big })),
        },
      ],
      snapshot: {
        now: new Date().toISOString(),
        timezone: "America/Los_Angeles",
        profile: { name: "A", grade: "9", school: "W", city: "SC" },
        schoolDay: { isSchoolDay: true, reason: "School day" },
        availableMin: 60,
        tasks: [],
        assignments: [],
        events: [],
        notes: [],
        courses: [],
        isDemo: true,
      },
      clientId: "client-12345678",
    };
    const parsed = CompassRequestSchema.safeParse(request);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toMatch(/too large/);
  });
});

describe("the painter", () => {
  it("asks the big models for any size and the small ones for a square", () => {
    expect(imageTool("gpt-image-2")["size"]).toBe("auto");
    expect(imageTool("gpt-image-1-mini")["size"]).toBe("1024x1024");
    expect(imageTool("gpt-image-2")["type"]).toBe("image_generation");
  });

  it("tells an image-model failure from a chat-model one", () => {
    expect(
      isImageModelFailure(
        new Error(
          "Request too large for gpt-image-2 (for limit gpt-image) … Limit 0, Requested 34.",
        ),
      ),
    ).toBe(true);
    expect(isImageModelFailure(new Error("Rate limit reached for gpt-5.6-terra"))).toBe(false);
  });

  it("explains a zero budget in terms of the billing page", () => {
    expect(pictureUnavailableMessage(new Error("… on tokens per min (TPM): Limit 0 …"))).toMatch(
      /payment method/,
    );
    expect(pictureUnavailableMessage(new Error("content policy"))).toMatch(/content policy/);
  });

  it("changes the instructions when pictures are unavailable", () => {
    const snapshot = {
      now: "2026-10-27T20:00:00.000Z",
      timezone: "America/Los_Angeles",
      profile: { name: "Aadit", grade: "9", school: "Wilcox", city: "Santa Clara" },
      schoolDay: { isSchoolDay: true, reason: "School day" },
      availableMin: 60,
      tasks: [],
      assignments: [],
      events: [],
      notes: [],
      courses: [],
      isDemo: false,
    };
    expect(systemInstructions(snapshot, { pictures: "on" })).toMatch(
      /call the image_generation tool/,
    );
    expect(systemInstructions(snapshot, { pictures: "unavailable" })).toMatch(/no image credit/);
    expect(systemInstructions(snapshot, { pictures: "off" })).not.toMatch(/image_generation/);
  });
});

describe("classify, for a request over a model's minute", () => {
  it("moves on immediately instead of waiting", () => {
    const error = new OpenAI.APIError(
      429,
      {
        error: {
          message:
            "Request too large for gpt-5.6-terra on tokens per min (TPM): Limit 10000, Requested 12000.",
          code: "rate_limit_exceeded",
        },
      },
      "Request too large for gpt-5.6-terra on tokens per min (TPM): Limit 10000, Requested 12000.",
      new Headers(),
    );
    expect(classify(error)).toMatchObject({ retryable: true, immediate: true });
  });

  it("reads a status-less mid-stream failure from its code", () => {
    const error = new OpenAI.APIError(
      undefined,
      { message: "Rate limit reached", code: "rate_limit_exceeded" },
      "Rate limit reached",
      new Headers(),
    );
    expect(classify(error)).toMatchObject({ retryable: true, reason: "rate limited (429)" });
  });
});
