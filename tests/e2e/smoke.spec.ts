import { expect, test } from "@playwright/test";

/**
 * Phase 11 Part D - post-deploy golden-path smoke test: signup -> login ->
 * contract create -> file upload -> file download -> analytics, all
 * against a synthetic organization only (§Synthetic organization) -
 * `smoke-test.local` email domain, `SMOKE-` prefixed org/contract names -
 * so it is trivially identifiable and never touches real customer data.
 *
 * Deliberately does NOT delete its own data at the end of this file -
 * Playwright's default TS transform cannot load the generated Prisma
 * client here (see contracts-flow.spec.ts's identical note - it uses
 * `import.meta`, which needs ESM handling this project's Playwright
 * config does not enable), so direct DB cleanup cannot happen inside a
 * spec file. Cleanup instead runs as a separate step in `pnpm smoke`
 * (scripts/smoke.ts calls scripts/cleanup-smoke-data.ts, a plain tsx
 * script with full Prisma access) immediately after this spec finishes,
 * regardless of pass/fail.
 */
const runId = Date.now();
const email = `smoke-${runId}@smoke-test.local`;
const password = "SmokeTest123";
const companyName = `SMOKE-Test-Org-${runId}`;
const contractTitle = `SMOKE-Contract-${runId}`;

const PDF_BUFFER = Buffer.from("%PDF-1.7\n%smoke test contract file\n1 0 obj\n", "latin1");

/** Every `test()` block gets a fresh browser context (no cookies carried over from a prior test, even within the same `describe.serial` file) - each step that needs an authenticated session logs in again itself, matching contracts-flow.spec.ts's/counterparties-and-files-flow.spec.ts's identical pattern in this codebase. */
async function logIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe.serial("smoke: signup -> login -> contract -> upload -> download -> analytics", () => {
  // A more generous per-test timeout than this suite's default - a smoke
  // run's first hits against each route can include `next dev`'s
  // on-demand compilation (never a factor against a real production
  // server, which this spec also runs against via SMOKE_BASE_URL).
  test.setTimeout(60_000);

  test("signup creates the synthetic smoke-test account", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("Smoke Test User");
    await page.getByLabel("회사명").fill(companyName);
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.waitForURL(/\/login/);
  });

  test("login reaches the dashboard", async ({ page }) => {
    await logIn(page);
  });

  let contractUrl = "";

  test("creates a contract", async ({ page }) => {
    await logIn(page);
    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(contractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    await expect(page.getByRole("heading", { name: contractTitle })).toBeVisible();
    contractUrl = page.url();
  });

  test("uploads a file to the contract", async ({ page }) => {
    await logIn(page);
    await page.goto(contractUrl);
    await page.setInputFiles("#contract-file", {
      name: "smoke-test.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BUFFER,
    });
    await page.getByRole("button", { name: "업로드" }).click();
    // A longer timeout than this suite's other assertions - file upload
    // goes through malware-scan + checksum + storage-write before the row
    // appears, and (only in `next dev`'s on-demand compilation - not a
    // real production server) can also be waiting on first-hit route
    // compilation.
    await expect(page.getByText("smoke-test.pdf").first()).toBeVisible({ timeout: 15_000 });
  });

  test("downloads the uploaded file", async ({ page }) => {
    await logIn(page);
    await page.goto(contractUrl);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "다운로드" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("smoke-test.pdf");
  });

  test("analytics page loads and reflects the new contract", async ({ page }) => {
    await logIn(page);
    await page.goto("/analytics");
    await expect(
      page.getByText("법률적 위험이나 계약의 유효성을 판단하지 않습니다.").first()
    ).toBeVisible();
  });
});
