/**
 * Component tests for the core task flow, driven through the real store and the
 * real `LocalRepository` — no mocked persistence, so these also prove that a
 * completed task survives a remount.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskRow } from "@/components/os/task-row";
import { AuthGate } from "@/components/os/auth-gate";
import type { AuthSession, AuthStatus } from "@/lib/auth/context";
import { stableId } from "@/lib/core/ids";
import { OSProvider, useOS } from "@/lib/store";
import { APP_TZ, zonedToUtc } from "@/lib/core/time";
import type { Task } from "@/lib/core/types";

// ---- auth + router doubles ----------------------------------------------

const USER_ID = stableId("test-user");

const authState = {
  status: "authenticated" as AuthStatus,
  session: {
    mode: "google",
    profile: {
      id: USER_ID,
      email: "test@aaditos.app",
      name: "Aadit Mehta",
      school: "Wilcox High School",
      grade: "Grade 9",
      city: "Santa Clara, CA",
      timezone: APP_TZ,
    },
  } as AuthSession | null,
};

const navigate = vi.fn();

vi.mock("@/lib/auth/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/context")>();
  return {
    ...actual,
    useAuth: () => ({
      status: authState.status,
      session: authState.session,
      error: null,
      supabaseConfigured: false,
      signInWithGoogle: vi.fn(),
      signInWithPasscode: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    }),
  };
});

// The store picks Supabase whenever the browser has a project URL — which a
// developer's .env supplies to vitest too. These tests are about the local
// repository, so the project is declared absent here.
vi.mock("@/lib/auth/config", () => ({
  supabaseConfigured: false,
  supabaseUrl: undefined,
  supabaseAnonKey: undefined,
  LAST_ROUTE_KEY: "aaditos:last-route",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
  useRouterState: () => ({ href: "/tasks", pathname: "/tasks" }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  }),
}));

// ---- harness -------------------------------------------------------------

const NOW = zonedToUtc(2026, 8, 12, 14, 0, APP_TZ);

function TaskHarness() {
  const { workspace, status, createTask } = useOS();
  const open = workspace.tasks.filter((t) => t.status !== "done" && t.status !== "archived");
  const done = workspace.tasks.filter((t) => t.status === "done");

  if (status !== "ready") return <p>Loading…</p>;

  return (
    <div>
      <p data-testid="open-count">{open.length}</p>
      <p data-testid="done-count">{done.length}</p>
      <button
        type="button"
        onClick={() =>
          void createTask({
            title: "Write the OpenRubric one-pager",
            category: "work",
            estimateMin: 45,
            priority: "high",
            dueAt: NOW.toISOString(),
          })
        }
      >
        Add task
      </button>
      <button
        type="button"
        onClick={() =>
          void createTask({
            title: "Algebra 2 worksheet 1.1–1.3",
            category: "school",
            estimateMin: 30,
            dueAt: NOW.toISOString(),
          })
        }
      >
        Add worksheet
      </button>
      <ul>
        {workspace.tasks.map((task) => (
          <li key={task.id} data-testid="task-item">
            <TaskRow task={task} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderApp() {
  return render(
    <OSProvider>
      <TaskHarness />
    </OSProvider>,
  );
}

/** Nothing is seeded any more, so each test puts its own task on the list first. */
async function addWorksheet(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole("button", { name: "Add worksheet" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Add worksheet" }));
  await waitFor(() => expect(screen.getByText("Algebra 2 worksheet 1.1–1.3")).toBeInTheDocument());
}

describe("task flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    authState.status = "authenticated";
  });

  it("starts with an empty workspace — no sample data", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add task" })).toBeEnabled());
    expect(screen.getByTestId("open-count")).toHaveTextContent("0");
    expect(screen.getByTestId("done-count")).toHaveTextContent("0");
  });

  it("creates a task and shows it immediately", async () => {
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add task" })).toBeEnabled());

    const before = Number(screen.getByTestId("open-count").textContent);
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() =>
      expect(screen.getByText("Write the OpenRubric one-pager")).toBeInTheDocument(),
    );
    expect(Number(screen.getByTestId("open-count").textContent)).toBe(before + 1);
  });

  it("completes a task optimistically and moves it to done", async () => {
    const user = userEvent.setup();
    renderApp();
    await addWorksheet(user);

    const doneBefore = Number(screen.getByTestId("done-count").textContent);
    const checkbox = screen.getByRole("checkbox", { name: /Complete Algebra 2 worksheet/i });
    await user.click(checkbox);

    await waitFor(() =>
      expect(Number(screen.getByTestId("done-count").textContent)).toBe(doneBefore + 1),
    );
  });

  it("persists a completion across a remount", async () => {
    const user = userEvent.setup();
    const first = renderApp();
    await addWorksheet(user);
    await user.click(screen.getByRole("checkbox", { name: /Complete Algebra 2 worksheet/i }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /Reopen Algebra 2 worksheet/i })).toBeChecked(),
    );

    first.unmount();
    renderApp();

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /Reopen Algebra 2 worksheet/i })).toBeChecked(),
    );
  });

  it("persists a newly created task across a remount", async () => {
    const user = userEvent.setup();
    const first = renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add task" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() =>
      expect(screen.getByText("Write the OpenRubric one-pager")).toBeInTheDocument(),
    );

    first.unmount();
    renderApp();

    await waitFor(() =>
      expect(screen.getByText("Write the OpenRubric one-pager")).toBeInTheDocument(),
    );
  });

  it("reopens a completed task", async () => {
    const user = userEvent.setup();
    renderApp();
    await addWorksheet(user);

    await user.click(screen.getByRole("checkbox", { name: /Complete Algebra 2 worksheet/i }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /Reopen Algebra 2 worksheet/i })).toBeChecked(),
    );

    await user.click(screen.getByRole("checkbox", { name: /Reopen Algebra 2 worksheet/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /Complete Algebra 2 worksheet/i }),
      ).not.toBeChecked(),
    );
  });
});

describe("TaskRow", () => {
  const task: Task = {
    id: "t-overdue",
    // The title must NOT contain "overdue": the assertion below looks for that
    // word as evidence the row labels lateness in text, and a title carrying it
    // would satisfy the query even if the label were removed.
    title: "Signed permission slip",
    userId: USER_ID,
    category: "school",
    // Anchored well in the past rather than to a near-future literal, which
    // silently stops being overdue once the calendar passes it.
    dueAt: zonedToUtc(2020, 8, 10, 15, 0, APP_TZ).toISOString(),
    dueAllDay: false,
    priority: "urgent",
    status: "todo",
    estimateMin: 5,
    source: "manual",
    subtasks: [],
    attachments: [],
    position: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };

  it("labels an overdue task in text, not only colour", async () => {
    render(
      <OSProvider>
        <TaskRow task={task} />
      </OSProvider>,
    );
    const row = await screen.findByText("Signed permission slip");
    const container = row.closest("div.group");
    expect(container).not.toBeNull();
    expect(within(container as HTMLElement).getByText(/overdue/i)).toBeInTheDocument();
  });

  it("exposes priority as readable text, not just a coloured dot", async () => {
    render(
      <OSProvider>
        <TaskRow task={task} />
      </OSProvider>,
    );
    // The dot is decorative; the word is carried for assistive technology.
    expect(await screen.findByText("urgent priority")).toBeInTheDocument();
  });
});

describe("AuthGate", () => {
  it("does not render protected content while the session is restoring", () => {
    authState.status = "loading";
    render(
      <AuthGate>
        <p>Private dashboard</p>
      </AuthGate>,
    );
    expect(screen.queryByText("Private dashboard")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/restoring/i);
  });

  it("redirects to sign in and renders nothing private when signed out", async () => {
    authState.status = "signed-out";
    render(
      <AuthGate>
        <p>Private dashboard</p>
      </AuthGate>,
    );
    expect(screen.queryByText("Private dashboard")).not.toBeInTheDocument();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/signin", replace: true }));
  });

  it("renders protected content once authenticated", () => {
    authState.status = "authenticated";
    render(
      <AuthGate>
        <p>Private dashboard</p>
      </AuthGate>,
    );
    expect(screen.getByText("Private dashboard")).toBeInTheDocument();
  });
});
