import { expect, test, type Browser, type Page } from "@playwright/test";

/*
 * The newer widgets (Timer, Poll, Ideas, Asks, Free times, Calendar),
 * each with two people at the table.
 */

async function twoAtTable(browser: Browser, title: string): Promise<[Page, Page]> {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto("/");
  await a.getByLabel("Bento name").fill(title);
  await a.getByLabel("Your name").fill("Host");
  await a.getByRole("switch", { name: "Starter bento" }).click();
  await a.getByRole("button", { name: "Create bento" }).click();
  await expect(a).toHaveURL(/\/b\/[a-z0-9]+$/);
  await b.goto(a.url());
  await b.getByLabel("Your name").fill("Guest");
  await b.getByRole("button", { name: "Join the bento" }).click();
  await expect(b.getByText("2 people viewing the bento")).toBeVisible();
  return [a, b];
}

async function add(page: Page, name: string) {
  await page.getByRole("button", { name: "Add to bento" }).click();
  await page
    .getByRole("dialog", { name: "Add to bento" })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
  return page.locator(`[data-kind]`).last();
}

async function makeViewer(owner: Page, guest: Page) {
  await owner.getByRole("button", { name: "Share" }).click();
  const share = owner.getByRole("dialog", { name: "Share this bento" });
  await share.getByRole("button", { name: "What Guest can do" }).click();
  await share.getByRole("option", { name: "Can view" }).click();
  await share.getByRole("button", { name: "Close" }).click();
  await expect(guest.getByText("View only")).toBeVisible();
}

test("a timer counts down on everyone's screen, and anyone can pause it", async ({ browser }) => {
  const [a, b] = await twoAtTable(browser, "Timer");
  const timerA = await add(a, "Timer");
  const timerB = b.locator('[data-kind="timer"]');
  await timerA.getByRole("button", { name: /Set the length/ }).click();
  await timerA.getByLabel("Timer length").fill("0:30");
  await timerA.getByLabel("Timer length").press("Enter");
  await timerA.getByRole("button", { name: "Start" }).click();
  await expect(timerB.getByRole("timer")).toHaveText(/^0:(2\d|30)$/);
  await expect(timerB.getByText("running")).toBeVisible();
  await timerB.getByRole("button", { name: "Pause" }).click();
  await expect(timerA.getByText("paused")).toBeVisible();
  await expect(timerA.getByRole("button", { name: "Start" })).toBeVisible();
});

test("viewers vote in polls and upvote ideas, but can't change them", async ({ browser }) => {
  const [a, b] = await twoAtTable(browser, "Votes");
  await makeViewer(a, b);

  const pollA = await add(a, "Poll");
  // Typed straight away, before the server has confirmed the new poll.
  await pollA.getByLabel("Add an option").fill("Ramen");
  await pollA.getByLabel("Add an option").press("Enter");
  await pollA.getByLabel("Add an option").fill("Sushi");
  await pollA.getByLabel("Add an option").press("Enter");
  const pollB = b.locator('[data-kind="poll"]');
  await expect(pollB.getByLabel("Add an option")).toHaveCount(0);
  await pollB.getByRole("radio", { name: /Sushi/ }).click();
  await expect(pollA.getByText("1 vote")).toBeVisible();
  await expect(pollA.getByRole("radio", { name: /Sushi/ })).toContainText("1");

  const ideasA = await add(a, "Ideas");
  await ideasA.getByLabel("Add an idea").fill("Picnic");
  await ideasA.getByLabel("Add an idea").press("Enter");
  await ideasA.getByLabel("Add an idea").fill("Karaoke");
  await ideasA.getByLabel("Add an idea").press("Enter");
  const ideasB = b.locator('[data-kind="ideas"]');
  await ideasB.getByRole("button", { name: /^Vote for Karaoke/ }).click();
  // The most wanted rises to the top for everyone.
  await expect(ideasA.getByRole("listitem").first()).toContainText("Karaoke");
  await expect(ideasA.getByRole("button", { name: /^Vote for Karaoke, 1 votes/ })).toBeVisible();
  await expect(ideasB.getByLabel("Add an idea")).toHaveCount(0);
});

test("asks: someone else's new ask shows as new until you open that person", async ({ browser }) => {
  const [a, b] = await twoAtTable(browser, "Asks");
  const asksA = await add(a, "Asks");
  await asksA.getByLabel("Add a person").fill("Yuzu");
  await asksA.getByLabel("Add a person").press("Enter");
  const asksB = b.locator('[data-kind="asks"]');
  await asksB.getByRole("button", { name: /^Yuzu/ }).click();
  await asksB.getByLabel("Ask Yuzu for…").fill("Bring the tea");
  await asksB.getByLabel("Ask Yuzu for…").press("Enter");
  await expect(asksA.getByRole("button", { name: "Yuzu: 1 open, 1 new" })).toBeVisible();
  await asksA.getByRole("button", { name: /^Yuzu/ }).click();
  await expect(asksA.getByRole("checkbox", { name: "Bring the tea" })).toBeVisible();
  await asksA.getByRole("button", { name: "Back to everyone" }).click();
  await expect(asksA.getByRole("button", { name: "Yuzu: 1 open" })).toBeVisible();
});

test("free times: marked half hours show in each person's color, with who's free on hover", async ({
  browser,
}) => {
  const [a, b] = await twoAtTable(browser, "Free");
  const freeA = await add(a, "Free times");
  const cell = (page: Page) => page.locator('[data-kind="freetimes"] td[data-day="2"][data-r="20"]');
  await cell(a).click();
  await expect(cell(a)).toHaveAttribute("data-mine", "");
  await cell(b).click();
  // Two people free: a bar in each lane, the cell marked as everyone free,
  // and the list on hover names both.
  await expect(cell(a)).toHaveAttribute("aria-label", /Host, Guest \(everyone\)/);
  await expect(cell(b).locator("[data-on]")).toHaveCount(2);
  await expect(cell(b)).toHaveAttribute("data-all", "");
  await cell(b).hover();
  const pop = b.locator('[data-kind="freetimes"]').getByRole("tooltip");
  await expect(pop).toContainText("Host");
  await expect(pop).toContainText("Guest (you)");
  await expect(freeA.getByRole("tooltip")).toHaveCount(0);
});

test("calendar: events and the view are shared", async ({ browser }) => {
  const [a, b] = await twoAtTable(browser, "Plans");
  const calA = await add(a, "Calendar");
  await calA.getByRole("button", { name: "Add an event" }).click();
  await calA.getByLabel("Event name").fill("Team lunch");
  // Times are our own dropdowns (ui/Select), not native time inputs.
  await calA.getByRole("button", { name: "Starts" }).click();
  await a
    .getByRole("listbox", { name: "Starts" })
    .getByRole("option", { name: "12:00 PM", exact: true })
    .click();
  await calA.getByRole("button", { name: "Ends" }).click();
  await a
    .getByRole("listbox", { name: "Ends" })
    .getByRole("option", { name: "1:00 PM", exact: true })
    .click();
  await expect(calA.getByRole("button", { name: "Starts" })).toHaveText("12:00 PM");
  await calA.getByRole("button", { name: "Save" }).click();
  const calB = b.locator('[data-kind="calendar"]');
  await expect(calB.getByRole("button", { name: /Team lunch/ })).toBeVisible();
  await calA.getByRole("button", { name: "Week", exact: true }).click();
  await expect(calB.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("deleting asks first; guests delete only what they added, the creator anything", async ({ browser }) => {
  const [a, b] = await twoAtTable(browser, "Deletes");
  const hostPoll = await add(a, "Poll");
  await expect(b.locator('[data-kind="poll"]')).toHaveCount(1);

  // The guest can't delete the host's widget: no close button, and Delete does nothing.
  const pollB = b.locator('[data-kind="poll"]');
  await expect(pollB.getByRole("button", { name: "Delete poll" })).toHaveCount(0);
  await pollB.focus();
  await pollB.press("Delete");
  await expect(b.getByRole("alertdialog")).toHaveCount(0);

  // The guest's own widget: it asks first, and Cancel keeps it.
  const guestTimer = await add(b, "Timer");
  await expect(a.locator('[data-kind="timer"]')).toHaveCount(1);
  await guestTimer.hover();
  await guestTimer.getByRole("button", { name: "Delete timer" }).click();
  const ask = guestTimer.getByRole("alertdialog", { name: "Delete timer?" });
  await expect(ask).toContainText("This removes the widget and content for everyone.");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toBeHidden();
  await expect(guestTimer).toBeVisible();

  // Confirming deletes it for everyone.
  await guestTimer.hover();
  await guestTimer.getByRole("button", { name: "Delete timer" }).click();
  await ask.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(a.locator('[data-kind="timer"]')).toHaveCount(0);

  // The creator can delete anything, including the host's own poll.
  await hostPoll.hover();
  await hostPoll.getByRole("button", { name: "Delete poll" }).click();
  await hostPoll.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(pollB).toHaveCount(0);
});

test("notes: a dash starts a bullet list, Enter carries it on, and markdown shows when done", async ({
  browser,
}) => {
  const [a, b] = await twoAtTable(browser, "Markdown");
  const note = await add(a, "Sticky Note");
  await note.click();
  const field = a.getByLabel("Note text");
  await field.pressSequentially("## Bring **snacks**", { delay: 10 });
  await field.press("Enter");
  await field.pressSequentially("- chips", { delay: 10 });
  await field.press("Enter");
  await field.pressSequentially("fruit", { delay: 10 });
  await field.press("Enter");
  await field.press("Enter");
  await field.pressSequentially("[] tea", { delay: 10 });
  await expect(field).toHaveValue("## Bring **snacks**\n• chips\n• fruit\n☐ tea");
  await a.keyboard.press("Escape");

  const shown = b.locator('[data-kind="note"]');
  await expect(shown.locator("strong")).toHaveText("snacks");
  await expect(shown.getByText("chips")).toBeVisible();
  await expect(shown).not.toContainText("**");
});

test("the creator can clear the bento after confirming; guests can't", async ({ browser }) => {
  const [a, b] = await twoAtTable(browser, "Clear");
  await add(a, "Sticky Note");
  await add(a, "Poll");
  await expect(b.locator("[data-widget]")).toHaveCount(2);

  // Guests see the button, but can't use it.
  await b.getByRole("button", { name: "Bento settings" }).click();
  await expect(b.getByRole("button", { name: "Clear Bento" })).toBeDisabled();
  await b.keyboard.press("Escape");

  // Backing out of the confirmation keeps everything.
  await a.getByRole("button", { name: "Bento settings" }).click();
  await a.getByRole("button", { name: "Clear Bento" }).click();
  const confirm = a.getByRole("dialog", { name: "Clear this bento?" });
  await expect(confirm).toContainText("removes all 2 widgets");
  await confirm.getByRole("button", { name: "Keep it" }).click();
  await expect(confirm).toBeHidden();
  await expect(a.locator("[data-widget]")).toHaveCount(2);

  await a.getByRole("button", { name: "Bento settings" }).click();
  await a.getByRole("button", { name: "Clear Bento" }).click();
  await confirm.getByRole("button", { name: "Clear Bento" }).click();
  await expect(b.locator("[data-widget]")).toHaveCount(0);
  await expect(b.getByText("An empty bento.")).toBeVisible();
  // It stays cleared for someone arriving later.
  await b.reload();
  await expect(b.getByText("An empty bento.")).toBeVisible();
});
