import { expect, test } from "@playwright/test";

/**
 * §Phase 14.3 §40 - the landing page is entirely new surface (root "/"
 * used to be a bare redirect to /login) with zero prior E2E coverage.
 * Read-only page loads, no data mutation - no shared-state risk, so this
 * file does not need QUEUE_SPECS serialization (see playwright.config.ts).
 */
test.describe("landing page", () => {
  test("loads for an unauthenticated visitor and states what the product does", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("계약을 이해하는 AI");
    // Button (components/ui/button.tsx) renders `nativeButton={false}` +
    // `render={<Link .../>}` as accessible role="button", not "link" - even
    // though it navigates - matching this codebase's own existing E2E
    // convention (e.g. contracts-flow.spec.ts clicks "계약 생성", the
    // identical Button+Link pattern, via getByRole("button", ...)).
    await expect(page.getByRole("button", { name: "무료로 시작하기" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "로그인" }).first()).toBeVisible();
  });

  test("CTA links navigate to signup and login", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "무료로 시작하기" }).first().click();
    await expect(page).toHaveURL(/\/signup/);

    await page.goto("/");
    await page.getByRole("button", { name: "로그인" }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });

  // §28 - all 5 required breakpoints, not just the two smallest/largest -
  // a mid-range regression (e.g. a lg: breakpoint firing one size too
  // early) would slip through if only 375/1440 were checked.
  for (const { width, height } of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    test(`§28 - ${width}px viewport renders with no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
    });
  }

  test("§12 - prefers-reduced-motion stops the ambient background animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const durationSeconds = await page.locator(".landing-ambient-field").evaluate((element) => {
      const raw = getComputedStyle(element).animationDuration;
      // Browsers serialize the computed value in whichever unit is
      // shortest (e.g. "1e-05s"), not necessarily the "0.01ms" the CSS
      // source wrote - parse to a real number instead of string-matching
      // a specific serialization.
      return raw.endsWith("ms") ? parseFloat(raw) / 1000 : parseFloat(raw);
    });
    // The global reduced-motion rule (globals.css) forces animation-duration
    // to 0.01ms (0.00001s) - asserting the real computed value is that tiny,
    // not just "test passes".
    expect(durationSeconds).toBeLessThan(0.001);
  });

  test("§12 - without reduced-motion, the ambient background animates slowly (not disabled)", async ({ page }) => {
    await page.goto("/");
    const durationSeconds = await page.locator(".landing-ambient-field").evaluate((element) => {
      const raw = getComputedStyle(element).animationDuration;
      return raw.endsWith("ms") ? parseFloat(raw) / 1000 : parseFloat(raw);
    });
    expect(durationSeconds).toBeGreaterThan(10);
  });

  test("a logged-in user visiting / is redirected straight to the dashboard, never sees the landing page", async ({
    page,
  }) => {
    const runId = Date.now();
    const email = `landing-redirect-${runId}@e2e-test.local`;
    const password = "Password123";

    await page.goto("/signup");
    await page.getByLabel("이름").fill("Landing Redirect Owner");
    await page.getByLabel("회사명").fill(`Landing Redirect Co ${runId}`);
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.waitForURL(/\/login/);

    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto("/");
    await page.waitForURL(/\/dashboard/);
  });
});
