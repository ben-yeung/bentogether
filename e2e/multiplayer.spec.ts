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
  if (!opts.starter) await page.getByRole("switch", { name: "Starter bento" }).click();
  if (opts.cursors === false) await page.getByRole("switch", { name: "Live cursors" }).click();
  await page.getByRole("button", { name: "Create bento" }).click();
  await expect(page).toHaveURL(/\/b\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** The floating "+" opens the widget picker; pick a Note. */
async function addNote(page: Page) {
  await page.getByRole("button", { name: "Add to bento" }).click();
  await page
    .getByRole("dialog", { name: "Add to bento" })
    .getByRole("button", { name: /^Note\b/ })
    .click();
}

/** Opens a shared link and joins with a name, as a guest would. */
async function join(page: Page, url: string, name: string) {
  await page.goto(url);
  await expect(page.getByRole("dialog", { name: "Join this bento" })).toBeVisible();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join the bento" }).click();
}

/** Puts the caret at `at` in the note being typed in. */
async function caretAt(page: Page, at: number) {
  await page.getByLabel("Note text").evaluate((el: HTMLTextAreaElement, i) => {
    el.setSelectionRange(i, i);
    el.dispatchEvent(new Event("select"));
  }, at);
}

test("two people type in one note at once, and both see the same text", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "E2E lunch");
  await join(b, a.url(), "Guest");
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();
  await expect(a.getByText("2 people viewing the bento")).toBeVisible();

  await addNote(a);
  await expect(b.locator("[data-note]")).toHaveCount(1);

  await a.locator("[data-note]").first().click();
  await a.getByLabel("Note text").pressSequentially("Onigiri", { delay: 20 });

  // B sees the words stream in and who's typing.
  const bNote = b.locator("[data-note]").first();
  await expect(bNote).toContainText("Onigiri");
  await expect(bNote).toContainText("Host is typing");

  // B joins in at the start while A carries on at the end.
  await bNote.click();
  await expect(b.getByLabel("Note text")).toHaveValue("Onigiri");
  await caretAt(b, 0);
  await Promise.all([
    a.getByLabel("Note text").pressSequentially(" for everyone", { delay: 30 }),
    b.getByLabel("Note text").pressSequentially("Menu: ", { delay: 30 }),
  ]);
  await expect(a.getByLabel("Note text")).toHaveValue("Menu: Onigiri for everyone");
  await expect(b.getByLabel("Note text")).toHaveValue("Menu: Onigiri for everyone");

  // Each sees the other's caret in the note, flagged with their name and
  // "typing" (it stands in for their cursor), and who's typing.
  await expect(a.locator("[data-note]").first().getByText("Guest · typing", { exact: true })).toBeVisible();
  await expect(b.locator("[data-note]").first().getByText("Host · typing", { exact: true })).toBeVisible();
  await expect(a.locator("[data-note]").first()).toContainText("Guest is typing");

  // Finishing clears it, and the text is saved for newcomers.
  await a.keyboard.press("Escape");
  await b.keyboard.press("Escape");
  await expect(bNote).not.toContainText("is typing");
  const c = await (await browser.newContext()).newPage();
  await join(c, a.url(), "Late");
  await expect(c.locator("[data-note]").first()).toContainText("Menu: Onigiri for everyone");
});

test("typing through a dropped connection lands once it's back, merged with others' edits", async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // A's link to the bento. While `cut` is set, A's typing never arrives,
  // like edits lost when a connection dies; `drop()` then ends the link.
  let cut = false;
  let drop = async () => {};
  await a.routeWebSocket(/\/api\/boxes\/[a-z0-9]+\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (cut && typeof m === "string" && m.includes('"type":"text"')) return;
      server.send(m);
    });
    server.onMessage((m) => ws.send(m));
    drop = async () => {
      await ws.close({ code: 4000, reason: "test" });
      await server.close();
    };
  });

  await newBox(a, "Dropped");
  await join(b, a.url(), "Guest");
  await addNote(a);
  await expect(b.locator("[data-note]")).toHaveCount(1);

  await a.locator("[data-note]").first().click();
  await a.getByLabel("Note text").pressSequentially("Half a thought", { delay: 20 });
  await expect(b.locator("[data-note]").first()).toContainText("Half a thought");

  // A's next words go nowhere; B adds to the start meanwhile.
  cut = true;
  await a.getByLabel("Note text").pressSequentially(" and more", { delay: 20 });
  await b.locator("[data-note]").first().click();
  await caretAt(b, 0);
  await b.getByLabel("Note text").pressSequentially("Note: ", { delay: 20 });
  await expect(b.getByLabel("Note text")).toHaveValue("Note: Half a thought");

  // The line drops and comes back: A's words go again, once, in the right place.
  cut = false;
  await drop();
  const merged = "Note: Half a thought and more";
  await expect(a.getByLabel("Note text")).toHaveValue(merged);
  await expect(b.getByLabel("Note text")).toHaveValue(merged);
  await expect(a.locator("[data-note]").first().getByRole("status")).toHaveCount(0);
});

test("a tab running older code is asked to reload, not left hanging", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Versions");
  // B's tab says hello as last version's code would.
  await b.routeWebSocket(/\/api\/boxes\/[a-z0-9]+\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      const msg = typeof m === "string" ? (JSON.parse(m) as { t?: string; v?: number }) : null;
      server.send(msg?.t === "hello" ? JSON.stringify({ ...msg, v: 1 }) : m);
    });
    server.onMessage((m) => ws.send(m));
  });
  await join(b, a.url(), "Guest");
  await expect(b.getByRole("heading", { name: "There's a new version." })).toBeVisible();
  await expect(b.getByRole("button", { name: "Reload" })).toBeVisible();
  // The real bento never counted them.
  await expect(a.getByText("Just you viewing the bento")).toBeVisible();
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

test("the starter bento and box options are applied", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Options", { starter: true, cursors: false });
  // One of every widget, plus a second note with tips.
  await expect(a.locator("[data-widget]")).toHaveCount(10);
  for (const kind of ["note", "todo", "budget", "timer", "poll", "ideas", "asks", "freetimes", "calendar"])
    await expect(a.locator(`[data-kind="${kind}"]`).first()).toBeVisible();
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
  // The starter bento has two notes (welcome and tips).
  await expect(b.locator("[data-note]")).toHaveCount(2);

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
  await share.getByRole("button", { name: "What Guest can do" }).click();
  await share.getByRole("option", { name: "Can view" }).click();
  await share.getByRole("button", { name: "Close" }).click();

  await expect(b.getByText("View only")).toBeVisible();
  await expect(b.getByRole("button", { name: "Add to bento" })).toHaveCount(0);

  // Guests see Share read-only.
  await b.getByRole("button", { name: "Share" }).click();
  await expect(b.getByText("Ask the bento's owner to invite more people.")).toBeVisible();
  await expect(b.getByRole("button", { name: "Who can join" })).toBeDisabled();

  // The role sticks to the guest's device across a reload.
  await b.reload();
  await expect(b.getByText("View only")).toBeVisible();
});

test("a password protected bento asks newcomers for the password", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Secret");
  await a.getByRole("button", { name: "Share" }).click();
  const share = a.getByRole("dialog", { name: "Share this bento" });
  await share.getByRole("button", { name: "Who can join" }).click();
  await share.getByRole("option", { name: "Password protected" }).click();
  await share.getByLabel("Password").fill("onigiri");
  await share.getByRole("button", { name: "Set password" }).click();
  await expect(a.getByText("Password saved.")).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();

  await b.goto(a.url());
  await b.getByLabel("Your name").fill("Guest");
  await b.getByLabel("Password").fill("wrong-one");
  await b.getByRole("button", { name: "Join the bento" }).click();
  await expect(b.getByText("That password didn't work.")).toBeVisible();

  await b.getByLabel("Password").fill("onigiri");
  await b.getByRole("button", { name: "Join the bento" }).click();
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

/** The floating "+" opens the widget picker; pick a To-do. */
async function addTodo(page: Page) {
  await page.getByRole("button", { name: "Add to bento" }).click();
  await page.getByRole("dialog", { name: "Add to bento" }).getByRole("button", { name: /To-do/ }).click();
}

test("a to-do list is shared live: title, items, ticks and reordering", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Groceries");
  await join(b, a.url(), "Guest");
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();

  await addTodo(a);
  const listA = a.locator('[data-kind="todo"]');
  const listB = b.locator('[data-kind="todo"]');
  await expect(listB).toHaveCount(1);

  await listA.getByLabel("List title").fill("Picnic");
  await listA.getByLabel("List title").press("Enter");
  await expect(listB.getByLabel("List title")).toHaveValue("Picnic");

  for (const item of ["Rice", "Nori", "Tea"]) {
    await listA.getByLabel("Add an item").fill(item);
    await listA.getByLabel("Add an item").press("Enter");
  }
  await expect(listB.getByRole("checkbox")).toHaveCount(3);
  // Adding in a quick burst keeps you in the field (no loading flash).
  await expect(listA.getByLabel("Add an item")).toBeFocused();

  // Both people tick different items at once; neither undoes the other.
  await Promise.all([
    listA.getByRole("checkbox", { name: "Rice" }).click(),
    listB.getByRole("checkbox", { name: "Tea" }).click(),
  ]);
  for (const list of [listA, listB]) {
    await expect(list.getByRole("checkbox", { name: "Rice" })).toBeChecked();
    await expect(list.getByRole("checkbox", { name: "Tea" })).toBeChecked();
    await expect(list.getByRole("checkbox", { name: "Nori" })).not.toBeChecked();
  }

  // Alt+Up moves an item; everyone sees the new order.
  await listB.getByRole("checkbox", { name: "Tea" }).focus();
  await b.keyboard.press("Alt+ArrowUp");
  await expect(listA.locator("[data-item]")).toHaveText(["Rice", "Tea", "Nori"]);

  // A newcomer gets the saved list.
  const c = await (await browser.newContext()).newPage();
  await join(c, a.url(), "Late");
  await expect(c.locator('[data-kind="todo"] [data-item]')).toHaveText(["Rice", "Tea", "Nori"]);
});

test("a budget is shared live: set, subtract and add together, history and currency", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Trip");
  await join(b, a.url(), "Guest");
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();

  await a.getByRole("button", { name: "Add to bento" }).click();
  await a
    .getByRole("dialog", { name: "Add to bento" })
    .getByRole("button", { name: /Budget/ })
    .click();
  const budgetA = a.locator('[data-kind="budget"]');
  const budgetB = b.locator('[data-kind="budget"]');
  await expect(budgetB).toHaveCount(1);

  // Tap the total to set it.
  await budgetA.getByRole("button", { name: /Set the amount/ }).click();
  await budgetA.getByLabel(/New amount/).fill("500");
  await budgetA.getByLabel(/New amount/).press("Enter");
  await expect(budgetB.getByRole("button", { name: /Set the amount/ })).toHaveText("$500");

  // Clicking elsewhere in the budget saves the new total and closes the field.
  await budgetA.getByRole("button", { name: /Set the amount/ }).click();
  await budgetA.getByLabel(/New amount/).fill("480");
  await budgetA.getByText("left to spend", { exact: true }).click();
  await expect(budgetA.getByLabel(/New amount/)).toHaveCount(0);
  await expect(budgetB.getByRole("button", { name: /Set the amount/ })).toHaveText("$480");
  // And with nothing changed, it just closes.
  await budgetA.getByRole("button", { name: /Set the amount/ }).click();
  await budgetA.getByText("left to spend", { exact: true }).click();
  await expect(budgetA.getByLabel(/New amount/)).toHaveCount(0);
  await budgetA.getByRole("button", { name: /Set the amount/ }).click();
  await budgetA.getByLabel(/New amount/).fill("500");
  await budgetA.getByLabel(/New amount/).press("Enter");
  await expect(budgetB.getByRole("button", { name: /Set the amount/ })).toHaveText("$500");

  // Both subtract at the same moment; both count.
  const subtract = async (budget: typeof budgetA, amount: string) => {
    await budget.getByLabel("Amount to add or subtract").fill(amount);
    await budget.getByRole("button", { name: "Subtract", exact: true }).click();
  };
  await Promise.all([subtract(budgetA, "20"), subtract(budgetB, "20")]);
  for (const budget of [budgetA, budgetB])
    await expect(budget.getByRole("button", { name: /Set the amount/ })).toHaveText("$460");

  // Add a typed amount; the field clears (a second click can't spend it
  // twice) and keeps focus for the next one.
  await budgetB.getByLabel("Amount to add or subtract").fill("12.50");
  await budgetB.getByRole("button", { name: "Add", exact: true }).click();
  await expect(budgetA.getByRole("button", { name: /Set the amount/ })).toHaveText("$472.50");
  await expect(budgetB.getByLabel("Amount to add or subtract")).toHaveValue("");
  await expect(budgetB.getByLabel("Amount to add or subtract")).toBeFocused();

  // Enter subtracts.
  await budgetB.getByLabel("Amount to add or subtract").fill("12.50");
  await budgetB.getByLabel("Amount to add or subtract").press("Enter");
  await expect(budgetA.getByRole("button", { name: /Set the amount/ })).toHaveText("$460");

  // History is behind its own button, and only for you.
  await budgetA.hover();
  await budgetA.getByRole("button", { name: "Show history" }).click();
  await expect(budgetA.getByRole("list", { name: "Recent changes" }).locator("li").first()).toContainText(
    "Guest",
  );
  await expect(budgetB.getByRole("list", { name: "Recent changes" })).toHaveCount(0);
  await budgetA.getByRole("button", { name: "Hide history" }).click();

  // Switching currency keeps the number.
  await budgetA.hover();
  await budgetA.getByRole("button", { name: "Currency" }).click();
  await budgetA.getByRole("option", { name: "EUR" }).click();
  await expect(budgetB.getByRole("button", { name: /Set the amount/ })).toContainText("460");
  await expect(budgetB.getByRole("button", { name: /Set the amount/ })).toContainText("€");
});

test("names are unique within a bento", async ({ browser }) => {
  const [a, b] = await twoPeople(browser);
  await newBox(a, "Same name");

  // Joining as "host" when Host is already here asks for another name.
  await join(b, a.url(), "host");
  await expect(b.getByText("Someone here is already called host.")).toBeVisible();
  await expect(b.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
  await b.getByLabel("Your name").fill("Guest");
  await b.getByRole("button", { name: "Join the bento" }).click();
  await expect(a.getByText("2 people viewing the bento")).toBeVisible();

  // Renaming to a taken name is refused and keeps the old one.
  await b.getByRole("button", { name: "Settings" }).click();
  const name = b.locator("#settings-name");
  await name.fill("HOST");
  await name.press("Enter");
  await expect(b.getByText("Someone here is already called HOST.")).toBeVisible();
  await expect(name).toHaveValue("Guest");
});
