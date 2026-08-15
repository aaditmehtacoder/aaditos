/**
 * Visual QA capture.
 *
 * Renders every page at the three supported viewports (and both themes) so
 * overflow, truncation, contrast and spacing can be inspected as images.
 *
 *   node scripts/screenshots.mjs [baseUrl] [outDir]
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://127.0.0.1:4173";
const OUT = resolve(process.argv[3] ?? "./.screenshots");

const VIEWPORTS = [
  { name: "chromebook", width: 1366, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const PAGES = [
  ["signin", "/signin"],
  ["today", "/"],
  ["school", "/school"],
  ["tasks", "/tasks"],
  ["projects", "/projects"],
  ["project-detail", "/projects/venu-ai"],
  ["opportunities", "/opportunities"],
  ["focus", "/focus"],
  ["orbit", "/orbit"],
  ["notifications", "/notifications"],
  ["integrations", "/integrations"],
  ["settings", "/settings"],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];

for (const viewport of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    page.on("console", (message) => {
      if (message.type() === "error") {
        problems.push(`[console ${viewport.name}/${theme}] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      problems.push(`[pageerror ${viewport.name}/${theme}] ${error.message}`);
    });

    // Enter demo mode once per context.
    await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Explore demo mode/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15_000 });
    await page.evaluate((t) => localStorage.setItem("aaditos:theme", t), theme);

    for (const [name, path] of PAGES) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(350);

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          horizontal: doc.scrollWidth - doc.clientWidth,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });
      if (overflow.horizontal > 1) {
        problems.push(
          `[overflow ${viewport.name}/${theme}] ${path}: ${overflow.scrollWidth}px content in ${overflow.clientWidth}px viewport`,
        );
      }

      await page.screenshot({
        path: resolve(OUT, `${viewport.name}-${theme}-${name}.png`),
        fullPage: false,
      });
    }

    await context.close();
  }
}

await browser.close();

if (problems.length > 0) {
  console.log("PROBLEMS:");
  for (const problem of problems) console.log(" -", problem);
  process.exitCode = 1;
} else {
  console.log("No overflow or console errors detected.");
}
console.log(`Screenshots written to ${OUT}`);
