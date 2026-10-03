import { expect, test } from "@playwright/test";

import {
  gotoReferenceHarnessReady,
  gotoWithReferenceSessionReady,
} from "./helpers/reference-session";

test.describe("Reference application smoke", () => {
  test("loads overview with harness link for anonymous visitors", async ({ page }) => {
    await gotoWithReferenceSessionReady(page, "/");
    await expect(page.getByText("Sign in required")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open harness" })).toBeVisible();
  });

  test("harness page is reachable", async ({ page }) => {
    await gotoReferenceHarnessReady(page);
    await expect(page.getByText("Reference mode active")).toBeVisible();
  });
});
