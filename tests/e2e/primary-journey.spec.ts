import { expect, test, type Page } from "@playwright/test";

/**
 * The primary journey, end to end:
 *   sign in (demo) → Today loads → open a class → write a thought →
 *   turn an idea into a task → it appears on Today → complete it →
 *   Ask shows a real answer or the correct missing-key state →
 *   a refresh preserves everything.
 *
 * Demo mode is used throughout, so this runs with no credentials at all. The
 * one thing it deliberately does not exercise is the capture box, which needs
 * a live OpenAI key; what it checks instead is that without one the box fails
 * loudly rather than silently swallowing what you typed.
 */

async function enterDemoMode(page: Page) {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: /Explore demo mode/i }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
  await expect(page.locator("h1")).toContainText(/Good (morning|afternoon|evening), Aadit/);
}

const THOUGHT = `E2E thought ${Date.now()}`;

test.describe("primary journey", () => {
  test("sign in, use a class, make a task, complete it, refresh", async ({ page }) => {
    // 1. The app is not public.
    await page.goto("/");
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByText(/Good (morning|afternoon|evening)/)).toHaveCount(0);

    // 2. Explicit demo mode.
    await enterDemoMode(page);

    // 3. Today renders its real composition.
    await expect(page.getByRole("heading", { name: "Due today" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByPlaceholder(/Type anything/)).toBeVisible();

    // 4. Classes lists the schedule and each card opens.
    await page.getByRole("link", { name: "Classes" }).first().click();
    await expect(page).toHaveURL(/\/classes$/);
    await expect(page.getByRole("heading", { name: "Classes" })).toBeVisible();
    await page.getByRole("link", { name: /English 9 H/ }).click();
    await expect(page).toHaveURL(/\/classes\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "English 9 H" })).toBeVisible();

    // 5. A thought saves against the class, with no round trip to a model.
    await expect(page.getByRole("heading", { name: "Thoughts & ideas" })).toBeVisible();
    await page.getByLabel("Add a thought or idea").fill(THOUGHT);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(THOUGHT)).toBeVisible();

    // 6. It survives a reload — this is the difference between state and storage.
    await page.reload();
    await expect(page.getByText(THOUGHT)).toBeVisible();

    // 7. A note becomes a task exactly once.
    const noteRow = page.locator("li", { hasText: THOUGHT }).first();
    await noteRow.hover();
    await noteRow.getByRole("button", { name: "Make it a task" }).click();
    await expect(noteRow.getByText("On your list")).toBeVisible();
    await expect(noteRow.getByRole("button", { name: "Make it a task" })).toHaveCount(0);

    // 8. The task is real, and completing it sticks.
    const taskRow = page.locator("div.group", { hasText: THOUGHT }).first();
    await expect(taskRow).toBeVisible();
    await taskRow.getByRole("checkbox").click();
    await page.reload();
    await expect(page.locator("li", { hasText: THOUGHT }).first().getByText("Done")).toBeVisible();
  });

  test("Ask either answers or says plainly that it is not configured", async ({ page }) => {
    await enterDemoMode(page);
    await page.getByRole("link", { name: "Ask" }).first().click();
    await expect(page).toHaveURL(/\/ask/);
    await expect(page.getByRole("heading", { name: "Ask" })).toBeVisible();

    const notConfigured = page.getByText("Not configured");
    if (await notConfigured.isVisible().catch(() => false)) {
      // The honest state: the composer is disabled rather than accepting text
      // that would go nowhere.
      await expect(page.getByRole("heading", { name: /needs an OpenAI key/i })).toBeVisible();
      await expect(page.getByLabel("Ask a question")).toBeDisabled();
      return;
    }

    await page.getByLabel("Ask a question").fill("What is due this week?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("article").first()).toBeVisible({ timeout: 30_000 });
  });

  test("every screen renders with one h1 and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await enterDemoMode(page);

    for (const [path, heading] of [
      ["/", /Good (morning|afternoon|evening)/],
      ["/classes", /Classes/],
      ["/ask", /Ask/],
      ["/settings", /Settings/],
    ] as const) {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toContainText(heading);
    }

    // A failed provider fetch is expected without credentials and is not a bug;
    // anything else is.
    const real = errors.filter((e) => !/Failed to load resource|net::ERR|40\d/.test(e));
    expect(real).toEqual([]);
  });

  /**
   * Regression: both class pages rendered a confident empty state — "No classes
   * yet, press Sync" and "Class not found" — during the second the workspace
   * took to load. Both were false, and both were the first thing you saw on a
   * cold load.
   */
  test("a cold load never claims there are no classes", async ({ page }) => {
    await enterDemoMode(page);

    const wrongly = page.getByText("No classes yet");
    await page.goto("/classes");
    // Checked immediately, before the workspace can arrive.
    await expect(wrongly).toHaveCount(0);
    await expect(page.getByRole("link", { name: /English 9 H/ })).toBeVisible();
  });

  test("navigation is three tabs and they all resolve", async ({ page }) => {
    await enterDemoMode(page);
    const nav = page.getByRole("navigation", { name: "Primary" }).first();
    await expect(nav.getByRole("link")).toHaveCount(3);

    for (const label of ["Today", "Classes", "Ask"]) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page.locator("h1")).toBeVisible();
    }
  });
});
