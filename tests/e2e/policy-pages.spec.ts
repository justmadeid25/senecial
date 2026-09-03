import { expect, test } from "@playwright/test";

/**
 * §Closed Beta P0 legal/AI disclosure - /privacy and /terms are public,
 * unauthenticated read-only page loads with no data mutation, matching
 * landing-page.spec.ts's own rationale for not needing QUEUE_SPECS
 * serialization.
 */
test.describe("policy pages", () => {
  test("/privacy loads for an unauthenticated visitor", async ({ page }) => {
    const response = await page.goto("/privacy");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("개인정보처리방침");
  });

  test("/terms loads for an unauthenticated visitor", async ({ page }) => {
    const response = await page.goto("/terms");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("이용약관");
  });

  test("landing page footer links to /privacy and /terms", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "개인정보처리방침" }).first()).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("link", { name: "이용약관" }).first()).toHaveAttribute("href", "/terms");
  });

  test("signup page links to /terms and /privacy", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("link", { name: "이용약관" })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: "개인정보처리방침" })).toHaveAttribute("href", "/privacy");
  });

  test("/privacy and /terms cross-link to each other from their own header nav", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("link", { name: "이용약관" })).toHaveAttribute("href", "/terms");
    await page.goto("/terms");
    await expect(page.getByRole("link", { name: "개인정보처리방침" })).toHaveAttribute("href", "/privacy");
  });
});
