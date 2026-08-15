import { describe, expect, it } from "vitest";

import { APP_TZ, zonedToUtc } from "@/lib/core/time";
import {
  COMPASS_TOOLS,
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  isWriteTool,
  runTool,
} from "@/lib/compass/tools";
import type { ConflictReport, DailyPlan, CompassSnapshot } from "@/lib/compass/types";

const NOW = zonedToUtc(2026, 8, 12, 15, 30, APP_TZ);
const at = (h: number, m = 0, day = 12) => zonedToUtc(2026, 8, day, h, m, APP_TZ).toISOString();

const snapshot: CompassSnapshot = {
  now: NOW.toISOString(),
  timezone: APP_TZ,
  profile: { name: "Aadit Mehta", grade: "Grade 9", school: "Wilcox", city: "Santa Clara" },
  schoolDay: { isSchoolDay: true, reason: "School day" },
  availableMin: 120,
  isDemo: true,
  courses: ["Algebra 2", "Biology"],
  tasks: [
    {
      id: "t1",
      title: "Algebra 2 worksheet",
      category: "school",
      priority: "high",
      status: "todo",
      estimateMin: 30,
      dueAt: at(18),
      dueAllDay: false,
      course: "Algebra 2",
      subtasksOpen: 0,
    },
    {
      id: "t2",
      title: "Venu issue #1754",
      category: "work",
      priority: "urgent",
      status: "in_progress",
      estimateMin: 45,
      dueAt: at(17, 30),
      dueAllDay: false,
      project: "Venu AI",
      subtasksOpen: 1,
    },
    {
      id: "t3",
      title: "Someday: learn Rust",
      category: "personal",
      priority: "low",
      status: "todo",
      estimateMin: 240,
      dueAllDay: false,
      subtasksOpen: 0,
    },
    {
      id: "t4",
      title: "Already finished",
      category: "school",
      priority: "normal",
      status: "done",
      estimateMin: 15,
      dueAllDay: false,
      subtasksOpen: 0,
    },
  ],
  assignments: [
    {
      id: "a1",
      title: "Lab safety contract",
      course: "Biology",
      state: "due_soon",
      dueAt: at(15, 0),
      estimateMin: 5,
    },
    {
      id: "a2",
      title: "Reading inventory",
      course: "Biology",
      state: "graded",
      dueAt: at(23, 59, 7),
      estimateMin: 15,
      grade: "10/10",
    },
  ],
  events: [
    {
      id: "e1",
      title: "Venu standup",
      startAt: at(16),
      endAt: at(16, 30),
      allDay: false,
      kind: "meeting",
      source: "demo",
    },
    {
      id: "e2",
      title: "Counselor",
      startAt: at(16, 15),
      endAt: at(16, 45),
      allDay: false,
      kind: "counseling",
      source: "demo",
    },
    {
      id: "e3",
      title: "Picture Day",
      startAt: at(0, 0, 18),
      allDay: true,
      kind: "school",
      source: "wilcox",
    },
  ],
  projects: [
    {
      id: "origami-prep",
      name: "Origami Prep",
      objective: "Keep the streak engine reliable",
      health: "at_risk",
      progress: 60,
      blockers: ["streak-reminder.yml failing"],
      openTasks: 1,
      recentActivity: ["Workflow failed"],
    },
  ],
  opportunities: [
    { id: "o1", org: "hackUMBC", title: "hackUMBC 2026", type: "hackathon", stage: "interested" },
    { id: "o2", org: "Venu AI", title: "Part-time SWE", type: "internship", stage: "interview" },
  ],
  focus: {
    last7DaysMin: 275,
    byCategory: { work: 180, school: 95 },
    sessionCount: 6,
    longestSessionMin: 55,
  },
};

describe("tool definitions", () => {
  it("declares every tool with a strict schema", () => {
    for (const tool of COMPASS_TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.type).toBe("function");
      const params = tool.parameters as {
        required?: string[];
        properties?: object;
        additionalProperties?: boolean;
      };
      expect(params.additionalProperties).toBe(false);
      // Strict mode requires every property to be listed as required.
      expect(Object.keys(params.properties ?? {}).sort()).toEqual(
        [...(params.required ?? [])].sort(),
      );
    }
  });

  it("covers exactly the declared read and write tool names", () => {
    const names = COMPASS_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].sort());
  });

  it("classifies write tools correctly", () => {
    expect(isWriteTool("propose_task")).toBe(true);
    expect(isWriteTool("update_task")).toBe(true);
    expect(isWriteTool("list_tasks")).toBe(false);
  });
});

describe("read tools", () => {
  it("list_tasks defaults to open tasks only", () => {
    const result = runTool("list_tasks", {}, snapshot) as {
      data: { tasks: Array<{ id: string }> };
    };
    expect(result.data.tasks.map((t) => t.id)).not.toContain("t4");
  });

  it("list_tasks filters by due window", () => {
    const result = runTool("list_tasks", { dueWithinDays: 0 }, snapshot) as {
      data: { tasks: Array<{ id: string }> };
    };
    expect(result.data.tasks.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("list_tasks filters by course", () => {
    const result = runTool("list_tasks", { courseName: "Algebra 2" }, snapshot) as {
      data: { tasks: Array<{ id: string }> };
    };
    expect(result.data.tasks.map((t) => t.id)).toEqual(["t1"]);
  });

  it("get_task reports not_found instead of inventing a task", () => {
    const result = runTool("get_task", { id: "nope" }, snapshot) as { data: { error?: string } };
    expect(result.data.error).toBe("not_found");
  });

  it("list_assignments filters by state", () => {
    const result = runTool("list_assignments", { state: "graded" }, snapshot) as {
      data: { assignments: Array<{ id: string }> };
    };
    expect(result.data.assignments.map((a) => a.id)).toEqual(["a2"]);
  });

  it("list_events respects the day range", () => {
    const today = runTool("list_events", { fromDays: 0, toDays: 0 }, snapshot) as {
      data: { events: Array<{ id: string }> };
    };
    expect(today.data.events.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });

  it("get_project_status resolves by name as well as id", () => {
    const byName = runTool("get_project_status", { projectId: "origami prep" }, snapshot) as {
      data: { name?: string };
    };
    expect(byName.data.name).toBe("Origami Prep");
  });

  it("list_opportunities filters by stage", () => {
    const result = runTool("list_opportunities", { stage: "interview" }, snapshot) as {
      data: { opportunities: Array<{ id: string }> };
    };
    expect(result.data.opportunities.map((o) => o.id)).toEqual(["o2"]);
  });

  it("find_schedule_conflicts detects the standup overlap", () => {
    const result = runTool("find_schedule_conflicts", { days: 7 }, snapshot) as {
      data: ConflictReport;
    };
    expect(result.data.conflicts).toHaveLength(1);
    expect(result.data.conflicts[0]?.overlapMin).toBe(15);
  });

  it("get_focus_summary reports real minutes", () => {
    const result = runTool("get_focus_summary", { days: 7 }, snapshot) as {
      data: { totalMin: number; sessionCount: number };
    };
    expect(result.data.totalMin).toBe(275);
    expect(result.data.sessionCount).toBe(6);
  });
});

describe("create_daily_plan", () => {
  it("fills the available time with the highest-value work", () => {
    const result = runTool("create_daily_plan", { availableMin: 90 }, snapshot) as {
      data: DailyPlan;
    };
    const plan = result.data;
    expect(plan.totalMinutes).toBeLessThanOrEqual(90);
    expect(plan.blocks[0]?.taskId).toBe("t2"); // urgent, due soonest
    expect(plan.blocks.every((b) => b.reason.length > 0)).toBe(true);
  });

  it("explains what it left out", () => {
    const result = runTool("create_daily_plan", { availableMin: 40 }, snapshot) as {
      data: DailyPlan;
    };
    expect(result.data.skipped.length).toBeGreaterThan(0);
    expect(result.data.skipped[0]?.reason).toMatch(/min/);
  });

  it("respects a category focus", () => {
    const result = runTool(
      "create_daily_plan",
      { availableMin: 120, focus: "school" },
      snapshot,
    ) as {
      data: DailyPlan;
    };
    expect(
      result.data.blocks
        .filter((b) => b.category !== "break")
        .every((b) => b.category === "school"),
    ).toBe(true);
  });

  it("never schedules more than the window allows", () => {
    const result = runTool("create_daily_plan", { availableMin: 15 }, snapshot) as {
      data: DailyPlan;
    };
    expect(result.data.totalMinutes).toBeLessThanOrEqual(15);
  });
});

describe("write tools never mutate", () => {
  it("propose_task returns a proposal that awaits confirmation", () => {
    const result = runTool(
      "propose_task",
      {
        title: "Draft the one-pager",
        category: "work",
        priority: "high",
        estimateMin: 45,
        dueAllDay: false,
        dueAt: at(20),
        courseName: null,
        projectName: null,
        description: null,
        subtasks: [],
      },
      snapshot,
    );
    expect((result.data as { status: string }).status).toBe("awaiting_confirmation");
    expect(result.proposal?.tool).toBe("propose_task");
    expect(result.proposal?.draft?.title).toBe("Draft the one-pager");
  });

  it("propose_task drops a course that the user does not have", () => {
    const result = runTool(
      "propose_task",
      {
        title: "Study",
        category: "school",
        priority: "normal",
        estimateMin: 30,
        dueAllDay: true,
        courseName: "Astrophysics",
        projectName: null,
        dueAt: null,
        description: null,
        subtasks: [],
      },
      snapshot,
    );
    expect(result.proposal?.draft?.courseName).toBeUndefined();
  });

  it("update_task refuses an unknown task", () => {
    const result = runTool("update_task", { taskId: "nope", priority: "urgent" }, snapshot);
    expect((result.data as { error?: string }).error).toBe("not_found");
    expect(result.proposal).toBeUndefined();
  });

  it("update_task rejects an empty patch", () => {
    const result = runTool("update_task", { taskId: "t1" }, snapshot);
    expect((result.data as { error?: string }).error).toBe("no_changes");
  });

  it("update_task summarizes exactly what would change", () => {
    const result = runTool("update_task", { taskId: "t1", priority: "urgent" }, snapshot);
    expect(result.proposal?.summary).toContain("Algebra 2 worksheet");
    expect(result.proposal?.update?.patch).toEqual({ priority: "urgent" });
  });
});

describe("unknown tools", () => {
  it("returns a structured error rather than throwing", () => {
    const result = runTool("nope" as never, {}, snapshot);
    expect((result.data as { error?: string }).error).toBe("unknown_tool");
  });
});
