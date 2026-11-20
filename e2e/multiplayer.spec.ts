import { expect, test, type Browser, type Page } from "@playwright/test";

/** Two people, each in their own browser context (separate storage). */
async function twoPeople(browser: Browser): Promise<[Page, Page]> {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  return [a, b];
}

async function newBox(page: Page, title: string, opts: { starter?: boolean; cursors?: boolean } = {}) {
  await page.goto("/");
  await page.getByLabel("Bento name").fill(title);
  await page.getByLabel("Your name").fill("Host");
  if (!opts.starter) await page.getByRole("switch", { name: "Starter notes" }).click();
  if (opts.cursors === false) await page.getByRole("switch", { name: "Live cursors" }).click();
  await page.getByRole("button", { name: "Create bento" }).click();
  await expect(page).toHaveURL(/\/b\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** The floating "+" opens the widget picker; pick a Sticky Note. */
async function addNote(page: Page) {
  await page.getByRole("button", { name: "Add to bento" }).click();
  await page
    .getByRole("dialog", { name: "Add to bento" })
    .getByRole("button", { name: /Sticky Note/ })
    .click();
}

/** Opens a shared link and joins with a name, as a guest would. */
async function join(page: Page, url: string, name: string) {
  await page.goto(url);
  await expect(page.getByRole("dialog", { name: "Join this bento" })).toBeVisible();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join the table" }).click();
}

test("a note added and typed by one person appears live for another", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "E2E lunch");
  await join(b, a.url(), "Guest");
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();
  await expect(a.getByText("2 people viewing the bento")).toBeVisible();

  await addNote(a);
  await expect(b.locator("[data-note]")).toHaveCount(1);

  await a.locator("[data-note]").first().click();
  await a.getByLabel("Note text").pressSequentially("Onigiri for everyone", { delay: 20 });

  // B sees the words stream in, who's typing, and their caret.
  await expect(b.locator("[data-note]").first()).toContainText("Onigiri for everyone");
  await expect(b.locator("[data-note]").first()).toContainText("is typing");

  // Only one person types in a note at a time.
  await b.locator("[data-note]").first().click();
  await expect(b.getByRole("status").filter({ hasText: "is typing here" })).toBeVisible();

  // Finishing releases it, and the text is saved for newcomers.
  await a.keyboard.press("Escape");
  await expect(b.locator("[data-note]").first()).not.toContainText("is typing");
  const c = await (await browser.newContext()).newPage();
  await join(c, a.url(), "Late");
  await expect(c.locator("[data-note]").first()).toContainText("Onigiri for everyone");
});

test("cursors show up for everyone else with the person's name", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Cursor check");
  await join(b, a.url(), "Guest");
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();

  const box = a.locator("[data-custom-cursor]");
  const bb = (await box.boundingBox())!;
  await a.mouse.move(bb.x + 200, bb.y + 120);
  await a.mouse.move(bb.x + 260, bb.y + 160, { steps: 5 });

  // The cursor anchor is a 0×0 point; assert on its name pill.
  await expect(b.locator("[data-visible]").getByText("Host", { exact: true })).toBeVisible();
});

test("starter notes and box options are applied", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Options", { starter: true, cursors: false });
  await expect(a.locator("[data-note]")).toHaveCount(3);
  await join(b, a.url(), "Guest");
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();

  const bb = (await a.locator("main").last().boundingBox())!;
  await a.mouse.move(bb.x + 300, bb.y + 400, { steps: 4 });
  await a.waitForTimeout(400);
  // Cursors off: no cursor layer at all, on either side.
  await expect(b.locator("[data-visible]")).toHaveCount(0);
});

test("a joiner's name is per box and remembered on reload", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Names");
  await join(b, a.url(), "Shiso");
  await expect(a.getByTitle("Shiso")).toBeVisible();
  await b.reload();
  await expect(b.getByRole("dialog", { name: "Join this bento" })).toHaveCount(0);
  await b.getByRole("button", { name: "Bento settings" }).click();
  await expect(b.getByLabel("Your name")).toHaveValue("Shiso");
});

test("people on different screen sizes see the same box, scaled", async ({ browser }) => {
  // A 1080p-class window and a 4K-class (100% scaling) window.
  const a = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const b = await (await browser.newContext({ viewport: { width: 3200, height: 1800 } })).newPage();
  await newBox(a, "Scale", { starter: true });
  await join(b, a.url(), "Big screen");
  await expect(b.locator("[data-note]")).toHaveCount(3);

  async function picture(page: Page) {
    return page.evaluate(() => {
      const board = document.querySelector<HTMLElement>("[data-custom-cursor]")!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>("[data-note]")].map((n) => {
        const r = n.getBoundingClientRect();
        const text = n.querySelector<HTMLElement>("[class*='text']")!;
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
        return {
          x: (r.left - board.left) / board.width,
          y: (r.top - board.top) / board.width,
          w: r.width / board.width,
          lines: Math.round(text.scrollHeight / lineHeight),
        };
      });
    });
  }

  const [pa, pb] = [await picture(a), await picture(b)];
  for (let i = 0; i < pa.length; i++) {
    expect(pb[i]!.x).toBeCloseTo(pa[i]!.x, 2);
    expect(pb[i]!.y).toBeCloseTo(pa[i]!.y, 2);
    expect(pb[i]!.w).toBeCloseTo(pa[i]!.w, 2);
    // Same wrapping, so a remote caret lands on the same word for both.
    expect(pb[i]!.lines).toBe(pa[i]!.lines);
  }
});

test("only the creator can rename the bento; everyone sees the credit", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Before");
  await join(b, a.url(), "Guest");
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();

  // Both see "by Host" next to the title.
  for (const page of [a, b])
    await expect(page.getByText("by", { exact: false }).getByText("Host")).toBeVisible();

  // The guest gets plain text, no rename control.
  await expect(b.getByRole("button", { name: /Rename bento/ })).toHaveCount(0);

  await a.getByRole("button", { name: /Rename bento/ }).click();
  await a.getByLabel("Bento name").fill("After");
  await a.keyboard.press("Enter");
  await expect(a.getByRole("heading", { name: "After" })).toBeVisible();
  await expect(b.getByRole("heading", { name: "After" })).toBeVisible();
  await expect(b).toHaveTitle(/After/);
});

test("the creator makes a guest a viewer from Share; the server holds them to it", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Roles");
  await join(b, a.url(), "Guest");
  await expect(b.getByRole("button", { name: "Add to bento" })).toBeVisible();

  await a.getByRole("button", { name: "Share" }).click();
  const share = a.getByRole("dialog", { name: "Share this bento" });
  await share.getByLabel("What Guest can do").selectOption("viewer");
  await share.getByRole("button", { name: "Close" }).click();

  await expect(b.getByText("View only")).toBeVisible();
  await expect(b.getByRole("button", { name: "Add to bento" })).toHaveCount(0);

  // Guests see Share read-only.
  await b.getByRole("button", { name: "Share" }).click();
  await expect(b.getByText("Only the creator can change who can join or edit.")).toBeVisible();
  await expect(b.getByLabel("Who can join")).toBeDisabled();

  // The role sticks to the guest's device across a reload.
  await b.reload();
  await expect(b.getByText("View only")).toBeVisible();
});

test("a password protected bento asks newcomers for the password", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Secret");
  await a.getByRole("button", { name: "Share" }).click();
  const share = a.getByRole("dialog", { name: "Share this bento" });
  await share.getByLabel("Who can join").selectOption("password");
  await share.getByLabel("Password").fill("onigiri");
  await share.getByRole("button", { name: "Set password" }).click();
  await expect(a.getByText("Password saved.")).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();

  await b.goto(a.url());
  await b.getByLabel("Your name").fill("Guest");
  await b.getByLabel("Password").fill("wrong-one");
  await b.getByRole("button", { name: "Join the table" }).click();
  await expect(b.getByText("That password didn't work.")).toBeVisible();

  await b.getByLabel("Password").fill("onigiri");
  await b.getByRole("button", { name: "Join the table" }).click();
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();

  // The creator never needs it.
  await a.reload();
  await expect(a.getByRole("heading", { name: "Secret" })).toBeVisible();
});

test("your color choice is remembered on this device", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Your color" }).click();
  await page.getByRole("radio", { name: "Color 130°" }).click();
  await expect(page.getByRole("radiogroup", { name: "Choose your color" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Your color" }).click();
  await expect(page.getByRole("radio", { name: "Color 130°" })).toHaveAttribute("aria-checked", "true");
});

test("bento settings: the creator changes them live, guests can't", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Settings");
  await join(b, a.url(), "Guest");
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();

  await b.getByRole("button", { name: "Bento settings" }).click();
  await expect(b.getByRole("switch", { name: "Live cursors" })).toBeDisabled();
  await b.keyboard.press("Escape");

  await a.getByRole("button", { name: "Bento settings" }).click();
  await a.getByRole("switch", { name: "Live cursors" }).click();
  await expect(a.getByRole("switch", { name: "Live cursors" })).toHaveAttribute("aria-checked", "false");

  // Everyone's box follows: cursors off means no custom cursor layer for the guest.
  await expect(b.locator("[data-custom-cursor]")).toHaveCount(0);
});

test("a missing bento says so", async ({ page }) => {
  await page.goto("/b/doesnotexist1");
  await expect(page.getByRole("heading", { name: "Nothing in this bento." })).toBeVisible();
});
