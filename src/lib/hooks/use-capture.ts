/**
 * Capture: text and images in, filed records out.
 *
 * Shared by the capture box and the Inbox's "File" button, so an email from
 * Gmail and a sentence you typed go through exactly the same path: the server
 * sorts the input into tasks, events and notes, this hook writes them, and
 * the toast offers Undo.
 */

import { useCallback } from "react";
import { toast } from "sonner";

import { authHeaders, clientId } from "@/lib/compass/client";
import { APP_TZ } from "@/lib/core/time";
import type { Attachment, NoteKind } from "@/lib/core/types";
import { MAX_UPLOAD_CHARS, blobToDataUrl, type PreparedImage } from "@/lib/repo/blobs";
import { useOS } from "@/lib/store";

export interface CapturedItem {
  kind: "task" | "event" | "note";
  title: string;
  description?: string | null;
  courseName?: string | null;
  location?: string | null;
  dueAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  allDay: boolean;
  category: "school" | "work" | "personal";
  priority: "urgent" | "high" | "normal" | "low";
  estimateMin: number;
  noteKind?: NoteKind | null;
}

export interface CaptureInput {
  text: string;
  /** Already downscaled; sent to the model and stored on every record it files. */
  images?: PreparedImage[] | undefined;
  /** Pre-attach everything to one class (a class page). */
  courseId?: string | undefined;
  /** Where the text came from, for the toast. */
  sourceLabel?: string | undefined;
}

export interface CaptureOutcome {
  ok: boolean;
  tasks: number;
  events: number;
  notes: number;
}

export function useCapture() {
  const { workspace, createTask, createNote, captureEvent, deleteTask, deleteNote, putAttachment } =
    useOS();

  return useCallback(
    async (input: CaptureInput): Promise<CaptureOutcome> => {
      const failed: CaptureOutcome = { ok: false, tasks: 0, events: 0, notes: 0 };
      const text = input.text.trim();
      const images = input.images ?? [];
      if (!text && images.length === 0) return failed;

      let payload: {
        ok: boolean;
        items?: CapturedItem[];
        dropped?: number;
        note?: string;
        message?: string;
      };
      const dataUrls = await Promise.all(images.map((i) => blobToDataUrl(i.blob)));
      // Checked here so the failure is a sentence, not a bare 413 from the host.
      if (dataUrls.reduce((n, d) => n + d.length, 0) > MAX_UPLOAD_CHARS) {
        toast.error("Those images are too large together", {
          description: "Attach fewer at a time.",
        });
        return failed;
      }

      let response: Response;
      try {
        response = await fetch("/api/capture", {
          method: "POST",
          headers: { "content-type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({
            text,
            images: dataUrls,
            courses: workspace.courses.filter((c) => c.active).map((c) => c.name),
            // A note usually names the teacher, not the subject: "Robson wants
            // the thesis arguable" only reaches the English page if the server
            // knows who Robson is.
            teachers: workspace.courses
              .filter((c) => c.active && c.teacher)
              .map((c) => `${c.name} — ${c.teacher}`),
            timezone: workspace.profile.timezone || APP_TZ,
            clientId: clientId(),
          }),
        });
      } catch {
        toast.error("Could not reach the server", { description: "Check your connection." });
        return failed;
      }
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // Not our JSON: the host answered before the app did.
        if (response.status === 413) {
          toast.error("Those images are too large to send", {
            description: "Attach fewer or smaller ones.",
          });
        } else {
          toast.error(`The server answered ${response.status}`, {
            description: "Try again in a moment.",
          });
        }
        return failed;
      }

      if (!payload.ok) {
        toast.error("Could not file that", { description: payload.message });
        return failed;
      }

      const items = payload.items ?? [];
      if (payload.dropped) {
        console.warn(`[capture] ${payload.dropped} item(s) came back malformed and were skipped`);
      }
      if (items.length === 0) {
        toast("Nothing to file", {
          description: payload.note ?? "Try naming what you want to do or remember.",
        });
        return failed;
      }

      // Images are stored once and attached to everything the model filed
      // from them — a photo of a sheet with two deadlines belongs on both.
      const attachments: Attachment[] = [];
      for (const image of images) {
        const stored = await putAttachment(image.blob, {
          name: image.name,
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
        });
        if (stored) attachments.push(stored);
      }

      // Ids of what actually got written, so Undo can take exactly that back.
      const savedTasks: string[] = [];
      const savedNotes: string[] = [];
      let events = 0;

      for (const item of items) {
        const course = item.courseName
          ? workspace.courses.find((c) => c.name === item.courseName)
          : undefined;
        // An explicit class page always wins over whatever the model guessed.
        const resolvedCourseId = input.courseId ?? course?.id;

        if (item.kind === "note") {
          const note = await createNote({
            courseId: resolvedCourseId,
            kind: item.noteKind ?? "thought",
            body: item.description ? `${item.title} — ${item.description}` : item.title,
            attachments,
          });
          if (note) savedNotes.push(note.id);
          continue;
        }

        if (item.kind === "event" && item.startAt) {
          const saved = await captureEvent({
            title: item.title,
            description: item.description ?? undefined,
            location: item.location ?? undefined,
            startAt: item.startAt,
            endAt: item.endAt ?? undefined,
            allDay: item.allDay,
            kind: "personal",
          });
          if (saved) events += 1;
          continue;
        }

        const task = await createTask({
          title: item.title,
          description: item.description ?? undefined,
          category: resolvedCourseId ? "school" : item.category,
          courseId: resolvedCourseId,
          dueAt: item.dueAt ?? undefined,
          dueAllDay: item.allDay,
          priority: item.priority,
          // The model returns 0 for anything it does not think takes time.
          // That is right for a note and wrong for a task, which needs a real
          // number for the "does this fit your next 45 minutes" ranking.
          estimateMin: item.estimateMin >= 5 ? item.estimateMin : 30,
          source: "manual",
          attachments,
        });
        if (task) savedTasks.push(task.id);
      }

      const parts = [
        savedTasks.length ? `${savedTasks.length} task${savedTasks.length === 1 ? "" : "s"}` : "",
        events ? `${events} event${events === 1 ? "" : "s"}` : "",
        savedNotes.length ? `${savedNotes.length} note${savedNotes.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean);

      toast.success(
        `Saved ${parts.join(" · ")}${input.sourceLabel ? ` from ${input.sourceLabel}` : ""}`,
        {
          description: items[0]?.title,
          // Events are not undone here: they are deduplicated by content, so
          // re-capturing the same one updates it rather than adding a second.
          action:
            savedTasks.length + savedNotes.length > 0
              ? {
                  label: "Undo",
                  onClick: () => {
                    void Promise.all([
                      ...savedTasks.map((id) => deleteTask(id)),
                      ...savedNotes.map((id) => deleteNote(id)),
                    ]);
                  },
                }
              : undefined,
        },
      );

      return { ok: true, tasks: savedTasks.length, events, notes: savedNotes.length };
    },
    [workspace, createTask, createNote, captureEvent, deleteTask, deleteNote, putAttachment],
  );
}
