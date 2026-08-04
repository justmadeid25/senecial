import { expect, test } from "@playwright/test";

const runId = Date.now();
const email = `e2e-${runId}@e2e-test.local`;
const password = "Password123";

test.describe.serial("signup -> login -> dashboard -> logout", () => {
  test("signup creates an account and redirects to login", async ({ page }) => {
    await page.goto("/signup");

    await page.getByLabel("이름").fill("E2E 테스터");
    await page.getByLabel("회사명").fill("E2E 테스트 회사");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);

    await page.getByRole("button", { name: "회원가입" }).click();

    await page.waitForURL(/\/login/);
    await expect(page.getByText("회원가입이 완료되었습니다")).toBeVisible();
  });

  test("login with the new account reaches the dashboard", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();

    await page.waitForURL(/\/dashboard/);
    await expect(page.getByText("E2E 테스터님, 환영합니다.")).toBeVisible();
    await expect(page.getByRole("banner")).toContainText("E2E 테스트 회사");
  });

  test("logout returns to login and blocks further dashboard access", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.getByRole("button", { name: "로그아웃" }).click();
    await page.waitForURL(/\/login/);

    await page.goto("/dashboard");
    await page.waitForURL(/\/login/);
  });
});

test("wrong password shows a generic error and does not reveal account existence", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("WrongPassword123");
  await page.getByRole("button", { name: "로그인" }).click();

  await expect(page.getByText("이메일 또는 비밀번호를 확인해 주세요.")).toBeVisible();
});
