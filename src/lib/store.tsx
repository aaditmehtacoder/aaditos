/**
 * Workspace store.
 *
 * Owns the loaded `Workspace`, every mutation, and the small amount of global
 * UI state (theme, command palette, quick add, live clock). Mutations apply
 * optimistically and roll back on failure; when the write failed because the
 * device is offline the change is queued in an outbox and replayed on
 * reconnect instead of being discarded.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { useAuth, userIdForSession, type AuthSession } from "@/lib/auth/context";
import { supabaseConfigured } from "@/lib/auth/config";
import { newId, stableId } from "@/lib/core/ids";
import { mergeBySourceRef } from "@/lib/core/normalize";
import { nowISO } from "@/lib/core/time";
import type {
  Assignment,
  CalendarEvent,
  Course,
  IntegrationRecord,
  Note,
  Profile,
  SyncRun,
  Task,
  UserPreferences,
  Workspace,
} from "@/lib/core/types";
import { LocalRepository } from "@/lib/repo/local";
import { emptyWorkspace } from "@/lib/repo/seed";
import { SupabaseRepository } from "@/lib/repo/supabase";
import type { NoteInput, Repository, TaskInput } from "@/lib/repo/types";

/**
 * Events the user captured or confirmed, kept on their own calendar so a
 * provider sync — which replaces one calendar wholesale — cannot delete them.
 */
export const CAPTURED_CALENDAR_ID = "aaditos:captured";

export interface CaptureEventInput {
  title: string;
  description?: string | undefined;
  location?: string | undefined;
  startAt: string;
  endAt?: string | undefined;
  allDay?: boolean | undefined;
  kind?: CalendarEvent["kind"] | undefined;
  source?: CalendarEvent["source"] | undefined;
  /** Stable key for the thing this came from, so re-confirming updates in place. */
  sourceRef?: string | undefined;
  externalUrl?: string | undefined;
}

export type Theme = "light" | "dark" | "system";
export type LoadStatus = "loading" | "ready" | "error";
export type ConnectionState = "online" | "offline";

interface OutboxEntry {
  id: string;
  label: string;
  run: (repo: Repository, userId: string) => Promise<unknown>;
}

interface OSState {
  status: LoadStatus;
  error: string | null;
  retry: () => void;

  workspace: Workspace;
  repositoryKind: Repository["kind"];
  isDemo: boolean;
  profile: Profile;
  userId: string;

  /** Ticks once a minute so relative times and "now" markers stay honest. */
  now: Date;

  createTask: (input: TaskInput) => Promise<Task | null>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  createNote: (input: NoteInput) => Promise<Note | null>;
  updateNote: (id: string, patch: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;

  savePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  applyIntegration: (record: IntegrationRecord) => Promise<void>;
  recordSyncRun: (run: SyncRun) => Promise<void>;

  /**
   * Imports from a provider sync. These persist through the repository, unlike
   * `applyWorkspacePatch`, which only touches memory — use them for anything
   * that must survive a reload.
   */
  importEvents: (calendarIds: string[], items: CalendarEvent[]) => Promise<void>;
  importCourses: (items: Course[]) => Promise<void>;
  importAssignments: (items: Assignment[]) => Promise<void>;

  /**
   * Adds one event the user captured by hand or confirmed from an email.
   *
   * Captured events live on their own calendar (`CAPTURED_CALENDAR_ID`) so a
   * provider sync — which replaces a whole calendar at a time — can never wipe
   * them. Returns the saved event, or null if it was rejected.
   */
  captureEvent: (input: CaptureEventInput) => Promise<CalendarEvent | null>;

  /**
   * In-memory only. Nothing written here survives a reload, so it must not be
   * used for synced records — see the import* methods above.
   */
  applyWorkspacePatch: (patch: Partial<Workspace>) => void;

  exportWorkspace: () => Promise<Workspace>;
  deleteAllData: () => Promise<void>;

  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;

  connection: ConnectionState;
  pendingWrites: number;
  syncing: boolean;
  setSyncing: (value: boolean) => void;
}

const Ctx = createContext<OSState | null>(null);
const THEME_KEY = "aaditos:theme";

function repositoryFor(session: AuthSession): Repository {
  if (session.mode === "google" && supabaseConfigured) {
    return new SupabaseRepository(() => session.profile);
  }
  return new LocalRepository(() => session.profile, session.mode === "demo");
}

export function OSProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [theme, setThemeState] = useState<Theme>("system");
  const [systemDark, setSystemDark] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("online");
  const [syncing, setSyncing] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(0);

  const userId = session ? userIdForSession(session) : "anonymous";
  const profile = useMemo<Profile>(
    () =>
      session?.profile ?? {
        id: "anonymous",
        email: "",
        name: "",
        school: "",
        grade: "",
        city: "",
        timezone: "America/Los_Angeles",
      },
    [session?.profile],
  );

  const [workspace, setWorkspace] = useState<Workspace>(() => emptyWorkspace(userId, profile));

  const repoRef = useRef<Repository | null>(null);
  const outbox = useRef<OutboxEntry[]>([]);
  // Lets a callback read the latest workspace without taking it as a dependency
  // and re-creating itself on every workspace change.
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  if (session && !repoRef.current) repoRef.current = repositoryFor(session);

  useEffect(() => {
    repoRef.current = session ? repositoryFor(session) : null;
  }, [session]);

  // ---- load -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setStatus("loading");
      return;
    }
    const repo = repoRef.current ?? repositoryFor(session);
    repoRef.current = repo;
    setStatus("loading");
    setError(null);
    repo
      .loadWorkspace(userId)
      .then((loaded) => {
        if (cancelled) return;
        setWorkspace(loaded);
        setThemeState(loaded.preferences.theme);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load your workspace.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [session, userId, reloadToken]);

  // ---- clock ------------------------------------------------------------
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- theme ------------------------------------------------------------
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") setThemeState(stored);
    } catch {
      /* storage unavailable */
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(query.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  // ---- connectivity + outbox -------------------------------------------
  const flushOutbox = useCallback(async () => {
    const repo = repoRef.current;
    if (!repo || outbox.current.length === 0) return;
    const queue = [...outbox.current];
    outbox.current = [];
    setPendingWrites(0);
    for (const entry of queue) {
      try {
        await entry.run(repo, userId);
      } catch {
        outbox.current.push(entry);
      }
    }
    setPendingWrites(outbox.current.length);
    if (outbox.current.length === 0 && queue.length > 0) {
      toast.success(`Synced ${queue.length} queued change${queue.length === 1 ? "" : "s"}`);
      setReloadToken((t) => t + 1);
    }
  }, [userId]);

  useEffect(() => {
    const goOnline = () => {
      setConnection("online");
      void flushOutbox();
    };
    const goOffline = () => setConnection("offline");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    setConnection(navigator.onLine ? "online" : "offline");
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flushOutbox]);

  /**
   * Apply `optimistic` immediately, then persist. On failure roll back — unless
   * we are offline and the operation is queueable, in which case keep the
   * optimistic state and replay later.
   */
  const mutate = useCallback(
    async <T,>(opts: {
      optimistic: (current: Workspace) => Workspace;
      persist: (repo: Repository, userId: string) => Promise<T>;
      label: string;
      queueable?: boolean;
    }): Promise<T | null> => {
      const repo = repoRef.current;
      if (!repo) return null;
      let previous: Workspace | null = null;
      setWorkspace((current) => {
        previous = current;
        return opts.optimistic(current);
      });
      try {
        return await opts.persist(repo, userId);
      } catch (err) {
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        if (offline && opts.queueable !== false) {
          outbox.current.push({ id: newId(), label: opts.label, run: opts.persist });
          setPendingWrites(outbox.current.length);
          return null;
        }
        if (previous) setWorkspace(previous);
        toast.error(`${opts.label} failed`, {
          description: err instanceof Error ? err.message : "Please try again.",
        });
        return null;
      }
    },
    [userId],
  );

  // ---- task actions -----------------------------------------------------
  const createTask = useCallback<OSState["createTask"]>(
    async (input) => {
      const repo = repoRef.current;
      if (!repo) return null;
      try {
        const created = await repo.createTask(userId, input);
        setWorkspace((ws) => ({ ...ws, tasks: [created, ...ws.tasks] }));
        return created;
      } catch (err) {
        toast.error("Could not save task", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
        return null;
      }
    },
    [userId],
  );

  const updateTask = useCallback<OSState["updateTask"]>(
    async (id, patch) => {
      await mutate({
        label: "Update task",
        optimistic: (ws) => ({
          ...ws,
          tasks: ws.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: nowISO() } : t)),
        }),
        persist: (repo, uid) => repo.updateTask(uid, id, patch),
      });
    },
    [mutate],
  );

  const toggleTask = useCallback<OSState["toggleTask"]>(
    async (id) => {
      const current = workspace.tasks.find((t) => t.id === id);
      if (!current) return;
      const nextStatus: Task["status"] = current.status === "done" ? "todo" : "done";
      await updateTask(id, {
        status: nextStatus,
        completedAt: nextStatus === "done" ? nowISO() : undefined,
      });
    },
    [workspace.tasks, updateTask],
  );

  const deleteTask = useCallback<OSState["deleteTask"]>(
    async (id) => {
      await mutate({
        label: "Delete task",
        optimistic: (ws) => ({ ...ws, tasks: ws.tasks.filter((t) => t.id !== id) }),
        persist: (repo, uid) => repo.deleteTask(uid, id),
      });
    },
    [mutate],
  );

  const createNote = useCallback<OSState["createNote"]>(
    async (input) => {
      const repo = repoRef.current;
      if (!repo || !input.body.trim()) return null;
      try {
        const created = await repo.createNote(userId, input);
        setWorkspace((ws) => ({ ...ws, notes: [created, ...ws.notes] }));
        return created;
      } catch (err) {
        toast.error("Could not save that", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
        return null;
      }
    },
    [userId],
  );

  const updateNote = useCallback<OSState["updateNote"]>(
    async (id, patch) => {
      await mutate({
        label: "Update note",
        optimistic: (ws) => ({
          ...ws,
          notes: ws.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowISO() } : n)),
        }),
        persist: (repo, uid) => repo.updateNote(uid, id, patch),
      });
    },
    [mutate],
  );

  const deleteNote = useCallback<OSState["deleteNote"]>(
    async (id) => {
      await mutate({
        label: "Delete note",
        optimistic: (ws) => ({ ...ws, notes: ws.notes.filter((n) => n.id !== id) }),
        persist: (repo, uid) => repo.deleteNote(uid, id),
      });
    },
    [mutate],
  );

  const savePreferences = useCallback<OSState["savePreferences"]>(
    async (patch) => {
      const next: UserPreferences = {
        ...workspace.preferences,
        ...patch,
        userId,
        updatedAt: nowISO(),
      };
      if (patch.theme) {
        setThemeState(patch.theme);
        try {
          window.localStorage.setItem(THEME_KEY, patch.theme);
        } catch {
          /* storage unavailable */
        }
      }
      await mutate({
        label: "Save preferences",
        optimistic: (ws) => ({ ...ws, preferences: next }),
        persist: (repo, uid) => repo.savePreferences(uid, next),
      });
    },
    [workspace.preferences, userId, mutate],
  );

  const applyIntegration = useCallback<OSState["applyIntegration"]>(
    async (record) => {
      await mutate({
        label: "Update integration",
        optimistic: (ws) => ({
          ...ws,
          integrations: ws.integrations.some((i) => i.id === record.id)
            ? ws.integrations.map((i) => (i.id === record.id ? record : i))
            : [...ws.integrations, record],
        }),
        persist: (repo, uid) => repo.upsertIntegration(uid, record),
      });
    },
    [mutate],
  );

  const recordSyncRun = useCallback<OSState["recordSyncRun"]>(
    async (run) => {
      await mutate({
        label: "Record sync",
        optimistic: (ws) => ({ ...ws, syncRuns: [run, ...ws.syncRuns].slice(0, 50) }),
        persist: (repo, uid) => repo.recordSyncRun(uid, run),
      });
    },
    [mutate],
  );

  /**
   * Replace every event on the given calendars. Idempotent, so re-syncing a
   * calendar updates rather than duplicating.
   */
  const importEvents = useCallback<OSState["importEvents"]>(
    async (calendarIds, items) => {
      await mutate({
        label: "Import events",
        optimistic: (ws) => ({
          ...ws,
          events: [...ws.events.filter((e) => !calendarIds.includes(e.calendarId)), ...items].sort(
            (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
          ),
        }),
        persist: (repo, uid) => repo.replaceEvents(uid, calendarIds, items),
      });
    },
    [mutate],
  );

  /**
   * Appends to the captured calendar rather than replacing it: `replaceEvents`
   * is all-or-nothing per calendar, so the current captured set has to be
   * carried forward or previous captures would vanish.
   */
  const captureEvent = useCallback<OSState["captureEvent"]>(
    async (input) => {
      const title = input.title.trim();
      const start = new Date(input.startAt);
      if (!title || Number.isNaN(start.getTime())) return null;

      const now = new Date().toISOString();
      const end = input.endAt ? new Date(input.endAt) : null;
      const event: CalendarEvent = {
        // Deterministic in the source reference, so confirming the same email
        // item twice updates one event instead of creating a duplicate.
        id: stableId(`captured:${input.sourceRef ?? `${title}:${start.toISOString()}`}`),
        userId,
        title,
        description: input.description,
        location: input.location,
        startAt: start.toISOString(),
        endAt: end && !Number.isNaN(end.getTime()) && end > start ? end.toISOString() : undefined,
        allDay: input.allDay ?? false,
        kind: input.kind ?? "personal",
        source: input.source ?? "manual",
        calendarId: CAPTURED_CALENDAR_ID,
        sourceRef: input.sourceRef,
        externalUrl: input.externalUrl,
        createdAt: now,
        updatedAt: now,
      };

      const kept = workspaceRef.current.events.filter(
        (e) => e.calendarId === CAPTURED_CALENDAR_ID && e.id !== event.id,
      );
      await importEvents([CAPTURED_CALENDAR_ID], [...kept, event]);
      return event;
    },
    [importEvents, userId],
  );

  const importCourses = useCallback<OSState["importCourses"]>(
    async (items) => {
      await mutate({
        label: "Import courses",
        optimistic: (ws) => ({ ...ws, courses: mergeBySourceRef(ws.courses, items) }),
        persist: (repo, uid) => repo.upsertCourses(uid, items),
      });
    },
    [mutate],
  );

  const importAssignments = useCallback<OSState["importAssignments"]>(
    async (items) => {
      await mutate({
        label: "Import assignments",
        optimistic: (ws) => ({ ...ws, assignments: mergeBySourceRef(ws.assignments, items) }),
        persist: (repo, uid) => repo.upsertAssignments(uid, items),
      });
    },
    [mutate],
  );

  const applyWorkspacePatch = useCallback<OSState["applyWorkspacePatch"]>((patch) => {
    setWorkspace((ws) => ({ ...ws, ...patch }));
  }, []);

  const exportWorkspace = useCallback<OSState["exportWorkspace"]>(async () => {
    const repo = repoRef.current;
    if (!repo) return workspace;
    return repo.exportWorkspace(userId);
  }, [userId, workspace]);

  const deleteAllData = useCallback<OSState["deleteAllData"]>(async () => {
    const repo = repoRef.current;
    if (!repo) return;
    await repo.deleteAllData(userId);
    setWorkspace(emptyWorkspace(userId, profile));
  }, [userId, profile]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        /* storage unavailable */
      }
      void savePreferences({ theme: next });
    },
    [savePreferences],
  );

  const value = useMemo<OSState>(
    () => ({
      status,
      error,
      retry: () => setReloadToken((t) => t + 1),
      workspace,
      repositoryKind: repoRef.current?.kind ?? "local",
      isDemo: session?.mode === "demo",
      profile,
      userId,
      now,
      createTask,
      updateTask,
      toggleTask,
      deleteTask,
      createNote,
      updateNote,
      deleteNote,
      savePreferences,
      applyIntegration,
      recordSyncRun,
      importEvents,
      captureEvent,
      importCourses,
      importAssignments,
      applyWorkspacePatch,
      exportWorkspace,
      deleteAllData,
      theme,
      resolvedTheme,
      setTheme,
      connection,
      pendingWrites,
      syncing,
      setSyncing,
    }),
    [
      status,
      error,
      workspace,
      session?.mode,
      profile,
      userId,
      now,
      createTask,
      updateTask,
      toggleTask,
      deleteTask,
      createNote,
      updateNote,
      deleteNote,
      savePreferences,
      applyIntegration,
      recordSyncRun,
      importEvents,
      captureEvent,
      importCourses,
      importAssignments,
      applyWorkspacePatch,
      exportWorkspace,
      deleteAllData,
      theme,
      resolvedTheme,
      setTheme,
      connection,
      pendingWrites,
      syncing,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOS(): OSState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOS must be used inside <OSProvider>");
  return ctx;
}
