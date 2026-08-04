import { expect, test } from "@playwright/test";

const runId = Date.now();
const verifiedFlowEmail = `e2e-account-security-${runId}@e2e-test.local`;
const rateLimitEmail = `e2e-rate-limit-${runId}@e2e-test.local`;
const password = "Password123";

test.describe.serial("account security - signup, email verification banner, forgot password", () => {
  test("signup, then the dashboard shows the unverified-email banner", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("E2E 계정보안 테스터");
    await page.getByLabel("회사명").fill("E2E 계정보안 테스트 회사");
    await page.getByLabel("이메일").fill(verifiedFlowEmail);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.waitForURL(/\/login/);

    await page.getByLabel("이메일").fill(verifiedFlowEmail);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);

    await expect(page.getByText("이메일 주소가 아직 인증되지 않았습니다.")).toBeVisible();
  });

  test("resending the verification email succeeds and updates the banner", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(verifiedFlowEmail);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.getByRole("button", { name: "인증 메일 재발송" }).click();
    await expect(page.getByText("인증 메일을 다시 보냈습니다.")).toBeVisible();
  });
});

test.describe("forgot password - account enumeration prevention (§18/§50)", () => {
  test("shows the same generic message for a non-existent email", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("이메일").fill(`does-not-exist-${runId}@e2e-test.local`);
    await page.getByRole("button", { name: "재설정 링크 받기" }).click();

    await expect(
      page.getByText("입력한 이메일과 일치하는 계정이 있다면 안내를 전송했습니다.")
    ).toBeVisible();
  });

  test("shows the exact same generic message for a real, existing email", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("이메일").fill(verifiedFlowEmail);
    await page.getByRole("button", { name: "재설정 링크 받기" }).click();

    await expect(
      page.getByText("입력한 이메일과 일치하는 계정이 있다면 안내를 전송했습니다.")
    ).toBeVisible();
  });
});

test("health endpoints respond and carry X-Request-Id (§34)", async ({ request }) => {
  const live = await request.get("/api/health/live");
  expect(live.ok()).toBe(true);
  expect(await live.json()).toEqual({ status: "ok" });
  expect(live.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

  const ready = await request.get("/api/health/ready");
  expect(ready.ok()).toBe(true);
  const readyBody = await ready.json();
  expect(readyBody.status).toBe("ok");
  expect(readyBody.checks).toEqual({
    database: "ok",
    storage: "ok",
    rateLimit: "ok",
    mail: "ok",
    config: "ok",
    batch: "ok",
    vectorSearch: "ok",
  });
  expect(ready.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
});

test("repeated failed login attempts against one account eventually trigger the rate limit (§16/§50)", async ({
  page,
}) => {
  await page.goto("/login");

  let sawRateLimitMessage = false;
  const wrongPasswordLocator = page.getByText("이메일 또는 비밀번호를 확인해 주세요.");
  const rateLimitLocator = page.getByText("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  // Default budget is 10 attempts / 5 minutes (RATE_LIMIT_LOGIN_MAX) - submit
  // one more than that so the last attempt must be rejected purely on
  // volume, using a dedicated email no other test touches.
  for (let attempt = 0; attempt < 11 && !sawRateLimitMessage; attempt += 1) {
    await page.getByLabel("이메일").fill(rateLimitEmail);
    await page.getByLabel("비밀번호").fill("WrongPassword123");
    await page.getByRole("button", { name: "로그인" }).click();

    // Wait for whichever of the two outcomes actually rendered, rather than
    // racing an unwaited isVisible() check against the in-flight Server
    // Action response.
    await expect(wrongPasswordLocator.or(rateLimitLocator)).toBeVisible();
    sawRateLimitMessage = await rateLimitLocator.isVisible();
  }

  expect(sawRateLimitMessage).toBe(true);
});
