import { expect, test, type WebSocketRoute } from "@playwright/test";

/**
 * What people see once Cloudflare's free daily quota is used up. The server
 * side (quota errors → 503 / close 4503) is unit-tested; here the responses
 * are stubbed so the UI can be checked without burning a real quota.
 */

test("making a bento when we're over capacity says so", async ({ page }) => {
  await page.route("**/api/boxes", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "over_capacity" },
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Bento name").fill("Full");
  await page.getByRole("button", { name: "Create bento" }).click();
  await expect(page.getByText(/used up its demo capacity for today/)).toBeVisible();
});

test("opening a bento when we're over capacity explains and offers a retry", async ({ page }) => {
  await page.route("**/api/boxes/*", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "over_capacity" },
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.goto("/b/somebox1234");
  await expect(page.getByRole("heading", { name: "We're full for today." })).toBeVisible();
  await expect(page.getByText(/Your bentos are safe/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("an unreachable server is explained, not an endless spinner", async ({ page }) => {
  await page.route("**/api/boxes/*", (route) => route.abort("failed"));
  await page.goto("/b/somebox1234");
  await expect(page.getByRole("heading", { name: "Can't reach the bento." })).toBeVisible();
  await expect(page.getByText(/today's demo capacity/)).toBeVisible();
});

test("running out mid-session pauses the bento with a notice", async ({ page }) => {
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    ws.connectToServer();
    socket = ws;
  });
  await page.goto("/");
  await page.getByLabel("Bento name").fill("Midway");
  await page.getByRole("button", { name: "Create bento" }).click();
  await expect(page.getByRole("heading", { name: "Midway" })).toBeVisible();

  await socket!.close({ code: 4503, reason: "over_capacity" });
  await expect(page.getByRole("alert").filter({ hasText: /used up its demo capacity/ })).toBeVisible();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
});
