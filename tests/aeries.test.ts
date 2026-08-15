/**
 * Aeries normalizers.
 *
 * The network layer needs a district-issued certificate that cannot be
 * exercised here, so the tested surface is the part that is genuinely ours:
 * turning inconsistently-shaped Aeries payloads into AaditOS records without
 * inventing grades or dropping data.
 */

import { describe, expect, it } from "vitest";

import {
  estimateFromPoints,
  normalizeAeriesAssignments,
  normalizeAeriesClasses,
  normalizeAeriesGrades,
} from "@/server/providers/aeries";

const USER = "user-1";
const NOW = "2026-08-12T14:00:00.000Z";

describe("normalizeAeriesClasses", () => {
  const rows = [
    {
      CourseName: "Algebra 2",
      SectionNumber: "1042",
      Period: 1,
      TeacherName: "Okafor, D",
      RoomNumber: "214",
    },
    // Aeries versions differ in casing; the parser must tolerate both.
    { coursename: "Biology", sectionNumber: "2210", period: "3", teacher: "Nguyen, T" },
    { CourseName: "", SectionNumber: "9999" },
    "not an object",
  ];

  it("maps the documented shape", () => {
    const courses = normalizeAeriesClasses(rows, USER, NOW);
    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({
      name: "Algebra 2",
      teacher: "Okafor, D",
      room: "214",
      period: 1,
      source: "aeries",
      active: true,
    });
  });

  it("tolerates lowercase keys and numeric strings", () => {
    const biology = normalizeAeriesClasses(rows, USER, NOW).find((c) => c.name === "Biology");
    expect(biology?.period).toBe(3);
    expect(biology?.teacher).toBe("Nguyen, T");
  });

  it("skips rows with no course name and non-objects", () => {
    expect(normalizeAeriesClasses(rows, USER, NOW).map((c) => c.name)).toEqual([
      "Algebra 2",
      "Biology",
    ]);
  });

  it("produces a stable id so re-imports update instead of duplicating", () => {
    const first = normalizeAeriesClasses(rows, USER, NOW);
    const second = normalizeAeriesClasses(rows, USER, "2026-09-01T00:00:00.000Z");
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.sourceRef).toBe("aeries:class:1042");
  });

  it("returns an empty array for a non-array payload", () => {
    expect(normalizeAeriesClasses(null, USER, NOW)).toEqual([]);
    expect(normalizeAeriesClasses({ error: "nope" }, USER, NOW)).toEqual([]);
  });
});

describe("normalizeAeriesAssignments", () => {
  const courseIdFor = (name: string) => (name === "Algebra 2" ? "course-algebra" : undefined);
  const opts = { userId: USER, now: NOW, courseIdFor };

  it("marks a scored assignment as graded and records the fraction", () => {
    const [assignment] = normalizeAeriesAssignments(
      [
        {
          AssignmentName: "Worksheet 1.1",
          GradebookName: "Algebra 2",
          AssignmentNumber: "12",
          NumberCorrect: 18,
          NumberCorrectPossible: 20,
          DueDate: "2026-08-14",
        },
      ],
      opts,
    );
    expect(assignment).toMatchObject({
      title: "Worksheet 1.1",
      state: "graded",
      grade: "18/20",
      points: 20,
      courseId: "course-algebra",
    });
  });

  it("never treats a blank score as a zero", () => {
    const [assignment] = normalizeAeriesAssignments(
      [
        {
          AssignmentName: "Essay draft",
          GradebookName: "Algebra 2",
          NumberCorrectPossible: 50,
          DueDate: "2027-01-01",
        },
      ],
      opts,
    );
    expect(assignment?.state).not.toBe("graded");
    expect(assignment?.grade).toBeUndefined();
  });

  it("honours an explicit missing flag", () => {
    const [assignment] = normalizeAeriesAssignments(
      [{ AssignmentName: "Lab report", GradebookName: "Algebra 2", Missing: true }],
      opts,
    );
    expect(assignment?.state).toBe("missing");
  });

  it("marks a completed but unscored assignment as submitted", () => {
    const [assignment] = normalizeAeriesAssignments(
      [{ AssignmentName: "Reading log", GradebookName: "Algebra 2", Completed: true }],
      opts,
    );
    expect(assignment?.state).toBe("submitted");
  });

  it("flags work due within three days as due soon", () => {
    const soon = new Date(Date.now() + 36 * 3600_000).toISOString();
    const [assignment] = normalizeAeriesAssignments(
      [{ AssignmentName: "Quiz prep", GradebookName: "Algebra 2", DueDate: soon }],
      opts,
    );
    expect(assignment?.state).toBe("due_soon");
  });

  it("leaves courseId undefined when the gradebook matches no known class", () => {
    const [assignment] = normalizeAeriesAssignments(
      [{ AssignmentName: "Mystery", GradebookName: "Underwater Basket Weaving" }],
      opts,
    );
    expect(assignment?.courseId).toBeUndefined();
  });

  it("ignores an unparseable due date rather than inventing one", () => {
    const [assignment] = normalizeAeriesAssignments(
      [{ AssignmentName: "Broken date", GradebookName: "Algebra 2", DueDate: "not-a-date" }],
      opts,
    );
    expect(assignment?.dueAt).toBeUndefined();
  });

  it("skips rows with no title and non-array payloads", () => {
    expect(normalizeAeriesAssignments([{ GradebookName: "Algebra 2" }], opts)).toEqual([]);
    expect(normalizeAeriesAssignments(undefined, opts)).toEqual([]);
  });

  it("produces stable ids across imports", () => {
    const rows = [
      { AssignmentName: "Worksheet 1.1", GradebookName: "Algebra 2", AssignmentNumber: "12" },
    ];
    const a = normalizeAeriesAssignments(rows, opts);
    const b = normalizeAeriesAssignments(rows, { ...opts, now: "2027-01-01T00:00:00.000Z" });
    expect(a[0]?.id).toBe(b[0]?.id);
  });
});

describe("estimateFromPoints", () => {
  it("scales the estimate with assignment weight", () => {
    expect(estimateFromPoints(5)).toBeLessThan(estimateFromPoints(40));
    expect(estimateFromPoints(40)).toBeLessThan(estimateFromPoints(200));
  });

  it("falls back to 30 minutes when Aeries gives no points", () => {
    expect(estimateFromPoints(undefined)).toBe(30);
    expect(estimateFromPoints(0)).toBe(30);
  });
});

describe("normalizeAeriesGrades", () => {
  it("prefers the letter mark and keeps the percent", () => {
    expect(normalizeAeriesGrades([{ CourseName: "Algebra 2", Mark: "A-", Percent: 91.4 }])).toEqual(
      [{ courseName: "Algebra 2", grade: "A-", percent: 91.4 }],
    );
  });

  it("falls back to a rounded percent when there is no mark", () => {
    expect(normalizeAeriesGrades([{ CourseName: "Biology", Percent: 88.6 }])[0]?.grade).toBe("89%");
  });

  it("drops rows with neither a mark nor a percent", () => {
    expect(normalizeAeriesGrades([{ CourseName: "Spanish 1" }])).toEqual([]);
  });

  it("returns an empty array for a non-array payload", () => {
    expect(normalizeAeriesGrades("<html>login</html>")).toEqual([]);
  });
});
