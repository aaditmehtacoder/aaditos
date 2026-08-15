import { expect, test, type Page } from "@playwright/test";

/**
 * The primary journey, end to end:
 *   sign in (demo) → Today loads → create a task → it appears in Today →
 *   start a focus session → complete the task → progress updates →
 *   Compass answers or shows the correct missing-key state →
 *   integration status is truthful → a refresh preserves everything.
 */

async function enterDemoMode(page: Page) {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: /Explore demo mode/i }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
  await expect(page.locator("h1")).toContainText(/Good (morning|afternoon|evening), Aadit/);
}

const UNIQUE = `E2E task ${Date.now()}`;

test.describe("primary journey", () => {
  test("sign in, plan, focus, complete and refresh", async ({ page }) => {
    // 1. The dashboard is not public.
    await page.goto("/");
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByText(/Good (morning|afternoon|evening)/)).toHaveCount(0);

    // 2. Explicit demo mode.
    await enterDemoMode(page);

    // 3. Today renders the real composition.
    await expect(page.getByRole("heading", { name: "Next move" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Must do today" })).toBeVisible();
    await expect(page.getByText("Focus time", { exact: true })).toBeVisible();
    // The date must stay on Today, not only in the planner header.
    await expect(page.getByText(/^\w{3}, \w{3} \d{1,2}$/)).toBeVisible();

    // 4. Create a task through Quick add, with a preview and explicit confirm.
    await page.getByRole("button", { name: /Quick add/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Task description").fill(`${UNIQUE} today at 8 PM for 20 minutes`);
    await expect(dialog.getByText("Preview")).toBeVisible();
    await expect(dialog.getByText("Parsed locally")).toBeVisible();
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toBeHidden();

    // 5. It shows up in Today.
    await expect(page.getByText(UNIQUE).first()).toBeVisible();

    // 6. Start a focus session on it.
    await page.goto("/tasks");
    const row = page.locator("div.group", { hasText: UNIQUE }).first();
    await row.hover();
    await row.getByRole("link", { name: "Focus" }).click();
    await expect(page).toHaveURL(/\/focus/);
    await page.getByRole("button", { name: /Start \d+-minute session/ }).click();
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByText("Running")).toBeVisible();

    // 7. The timer survives a refresh.
    await page.reload();
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByText("Restored after refresh")).toBeVisible();

    // 8. Finish the session; it is stored.
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText(/Saved \d+m on/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent sessions" })).toBeVisible();

    // 9. Complete the task and watch weekly progress update.
    const weeklyProgress = page.getByRole("progressbar", { name: "Tasks completed this week" });
    await page.goto("/");
    const before = Number(await weeklyProgress.getAttribute("aria-valuenow"));

    await page.goto("/tasks");
    // "Today" only lists open work, so completing there would hide the row.
    await page.getByRole("tab", { name: /^All/ }).click();
    await page
      .getByRole("checkbox", { name: new RegExp(`Complete ${escapeRegex(UNIQUE)}`) })
      .click();
    await expect(
      page.getByRole("checkbox", { name: new RegExp(`Reopen ${escapeRegex(UNIQUE)}`) }),
    ).toBeChecked();

    await page.goto("/");
    const after = Number(await weeklyProgress.getAttribute("aria-valuenow"));
    expect(after).toBeGreaterThan(before);

    // 10. A refresh preserves the completion.
    await page.reload();
    await page.goto("/tasks");
    await page.getByRole("tab", { name: /^All/ }).click();
    await expect(
      page.getByRole("checkbox", { name: new RegExp(`Reopen ${escapeRegex(UNIQUE)}`) }),
    ).toBeChecked();
  });

  test("Compass answers or states the missing-key case honestly", async ({ page }) => {
    await enterDemoMode(page);
    await page.goto("/compass");
    await expect(page.locator("h1")).toHaveText("Compass");

    const notConfigured = page.getByRole("heading", { name: "Compass needs an OpenAI key" });
    const input = page.getByLabel("Ask Compass");

    if (await notConfigured.isVisible()) {
      // Honest configuration state: no fake answers, input disabled.
      await expect(page.getByText("OPENAI_API_KEY")).toBeVisible();
      await expect(input).toBeDisabled();
      await expect(page.getByText("Not configured")).toBeVisible();
      return;
    }

    await input.fill("Plan my afternoon");
    await page.getByRole("button", { name: "Send to Compass" }).click();
    await expect(page.locator("article").filter({ hasText: /.+/ }).first()).toBeVisible({
      timeout: 40_000,
    });
  });

  test("integration status reflects reality", async ({ page }) => {
    await enterDemoMode(page);
    await page.goto("/integrations");
    await expect(page.locator("h1")).toHaveText("Integrations");

    // Wilcox needs no credentials, so syncing it must actually work.
    const wilcox = page.locator("section", { hasText: "Wilcox calendars" }).first();
    await wilcox.getByRole("button", { name: "Sync", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sync history" })).toBeVisible();
    await expect(page.getByText(/events from \d calendars/)).toBeVisible({ timeout: 30_000 });

    // Providers with no API must say so and offer no fake connect button.
    const linkedin = page.locator("section", { hasText: "LinkedIn" }).first();
    await expect(linkedin.getByText("Manual capture only")).toBeVisible();
    await expect(linkedin.getByRole("button", { name: "No API available" })).toBeDisabled();

    // A provider that is not configured must never offer a Sync that would fail.
    const github = page.locator("section", { hasText: "GitHub" }).first();
    await expect(github.getByText("Needs credentials").first()).toBeVisible();
    await expect(github.getByRole("button", { name: "Needs credentials" })).toBeDisabled();

    // Google is OAuth: until it is connected the action is Connect, not Sync.
    const googleCard = page.locator("section", { hasText: "Google Calendar" }).first();
    const connect = googleCard.getByRole("link", { name: "Connect" });
    const connectDisabled = googleCard.getByRole("button", { name: "Connect" });
    expect((await connect.count()) + (await connectDisabled.count())).toBeGreaterThan(0);
    await expect(googleCard.getByRole("button", { name: /^Sync$/ })).toHaveCount(0);
  });

  test("every primary route loads on direct navigation and survives a refresh", async ({
    page,
  }) => {
    await enterDemoMode(page);
    const routes: Array<[string, string]> = [
      ["/", "Today"],
      ["/school", "School"],
      ["/tasks", "Tasks"],
      ["/projects", "Projects"],
      ["/opportunities", "Opportunities"],
      ["/focus", "Focus"],
      ["/compass", "Compass"],
      ["/notifications", "Notifications"],
      ["/integrations", "Integrations"],
      ["/settings", "Settings"],
    ];

    for (const [path, title] of routes) {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveText(
        title === "Today" ? /Good (morning|afternoon|evening)/ : title,
      );
      await page.reload();
      await expect(page.locator("h1")).toHaveText(
        title === "Today" ? /Good (morning|afternoon|evening)/ : title,
      );
    }
  });

  test("the planner schedules work into real open time", async ({ page }) => {
    await enterDemoMode(page);

    const planner = page.locator("section", { hasText: "Plan my day" }).first();
    await expect(planner).toBeVisible();

    // The planner headline and the Today rail must never disagree about how
    // much time is left.
    const headline = await planner.getByText(/left · \d+ planned/).innerText();
    const railed = await page
      .getByText(/Focus time/)
      .locator("..")
      .innerText();
    const remaining = /(\d+h ?\d*m?|\d+m)/.exec(headline)?.[1];
    expect(remaining).toBeTruthy();
    expect(railed).toContain(remaining!);

    // Propose, review, then commit.
    await planner.getByRole("button", { name: "Plan my day" }).click();
    await expect(page.getByText("Proposed plan")).toBeVisible();
    const commit = page.getByRole("button", { name: /Add \d+ to the plan/ });
    await expect(commit).toBeVisible();
    await commit.click();

    await expect(page.getByText("Proposed plan")).toBeHidden();
    await expect(planner.getByText(/· [1-9]\d* planned/)).toBeVisible();

    // The plan survives a reload, because it is stored on the task.
    await page.reload();
    await expect(
      page
        .locator("section", { hasText: "Plan my day" })
        .first()
        .getByText(/· [1-9]\d* planned/),
    ).toBeVisible();
  });

  test("a project detail page opens from the list", async ({ page }) => {
    await enterDemoMode(page);
    await page.goto("/projects");
    await page.getByRole("link", { name: "Venu AI" }).first().click();
    await expect(page).toHaveURL(/\/projects\/venu-ai/);
    await expect(page.locator("h1")).toHaveText("Venu AI");
    await page.getByRole("tab", { name: /GitHub/ }).click();
    await expect(page.getByRole("heading", { name: "GitHub" }).first()).toBeVisible();
  });

  test("signing out clears access to the dashboard", async ({ page }) => {
    await enterDemoMode(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: /Leave demo mode/i }).click();
    await expect(page).toHaveURL(/\/signin/);
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe("no console errors", () => {
  test("Today and Tasks render without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await enterDemoMode(page);
    await page.goto("/tasks");
    await expect(page.locator("h1")).toHaveText("Tasks");

    const meaningful = errors.filter(
      (text) => !/favicon|manifest|service worker|Download the React DevTools/i.test(text),
    );
    expect(meaningful).toEqual([]);
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
