import { expect, test } from "@playwright/test";

import { cardByHeading } from "./helpers/scoping";

/**
 * Phase 14 Part 5 (performance - large storage objects). REAL bug found
 * via live load testing against the production Docker image: uploads
 * above ~10MB failed with a raw "Unexpected end of form" error, well
 * below the app's own advertised MAX_UPLOAD_SIZE_MB=20 cap. Root cause -
 * middleware.ts runs on every request, and Next.js caps how much of the
 * request body the middleware/proxy layer buffers at a SEPARATE,
 * lower-than-serverActions.bodySizeLimit default (10MB) unless
 * `experimental.proxyClientMaxBodySize` is also configured (next.config.ts)
 * - see that file's own comment for the full story. This test locks in
 * that a near-cap upload actually succeeds end-to-end through the real
 * HTTP/middleware path, not just the Server Action's own body-size check
 * (which a vitest integration test calling the feature function directly
 * would never exercise, since it never goes through middleware.ts at all).
 */
const runId = Date.now();
const email = `large-upload-e2e-${runId}@e2e-test.local`;
const password = "Password123";
const companyName = `Large Upload E2E Org ${runId}`;
const contractTitle = `대용량 업로드 테스트 ${runId}`;

function buildLargePdf(sizeBytes: number): Buffer {
  const header = Buffer.from("%PDF-1.7\n%large file regression test\n", "latin1");
  return Buffer.concat([header, Buffer.alloc(Math.max(0, sizeBytes - header.length), 0x41)]);
}

test.describe.serial("large file upload near the advertised MAX_UPLOAD_SIZE_MB cap", () => {
  test.setTimeout(120_000);

  test("signup and login", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("Large Upload Tester");
    await page.getByLabel("회사명").fill(companyName);
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.waitForURL(/\/login/);

    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);
  });

  let contractUrl = "";

  test("creates a contract", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto("/contracts/new");
    await page.getByLabel("계약명 *").fill(contractTitle);
    await page.getByLabel("계약 유형 *").click();
    await page.getByRole("option", { name: "용역계약" }).click();
    await page.getByRole("button", { name: "계약 생성" }).click();
    await page.waitForURL(/\/contracts\/(?!new$)[a-z0-9]{20,}$/);
    contractUrl = page.url();
  });

  test("uploads a 19MB file (near the 20MB advertised cap) successfully", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto(contractUrl);
    await page.waitForLoadState("networkidle");
    const largeBuffer = buildLargePdf(19 * 1024 * 1024);
    await page.setInputFiles("#contract-file", { name: "large-regression-test.pdf", mimeType: "application/pdf", buffer: largeBuffer });
    await page.getByRole("button", { name: "업로드" }).click();
    await expect(cardByHeading(page, "첨부 파일").getByText("large-regression-test.pdf")).toBeVisible({ timeout: 60_000 });
  });
});
