import {
  SYSTEM_AUTHOR,
  TIMER_DEFAULT_MS,
  bitsToSlots,
  slotAt,
  voterKey,
  FREE_SLOTS,
  type NoteColor,
  type Rect,
  type Widget,
} from "@bentogether/shared";

const DAY_MS = 86_400_000;

/**
 * Made-up teammates who fill in the starter widgets. They exist only inside
 * those widgets' data: new widgets start blank, and deleting a starter
 * widget takes its examples with it.
 */
const TEAM = {
  mochi: { name: "Mochi", hue: 250 },
  yuzu: { name: "Yuzu", hue: 90 },
  kombu: { name: "Kombu", hue: 150 },
  tofu: { name: "Tofu", hue: 330 },
} as const;
type Mate = keyof typeof TEAM;

/**
 * The base template ("starter" option): one of every widget, filled in
 * as a team planning an outing, so a new bento shows what each one does.
 * Sized to suit each kind and packed on the 12-column grid without overlaps:
 *
 *        x0      x4      x7  x9
 *   y0   Note    Budget  Tm  Poll
 *   y2   Note    To-do       Poll
 *   y3   Ideas   To-do       Poll
 *   y4   Ideas   To-do       Note
 *   y5   Ideas   Asks        Note
 *   y8   Calendar (7)    Free times (5)
 */
export function starterBento(boxId: string, now: number): Widget[] {
  let n = 0;
  /** Ids are made from the box's id, so seeding is repeatable and they stay unique per box. */
  const id = (tag: string) =>
    `${tag}${boxId}`
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 24)
      .padEnd(8, "0");
  const sub = (tag: string, i: number) =>
    `${tag}${i}${boxId}`
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 12)
      .padEnd(8, "0");
  const frame = (tag: string, rect: Rect, color: NoteColor, title = "") => ({
    id: id(tag),
    ...rect,
    color,
    title,
    createdBy: SYSTEM_AUTHOR,
    // Creation order sets the order on the page.
    createdAt: now + n++,
    updatedAt: now,
  });
  /** Signed by a teammate, a little while ago (older first). */
  let ago = 60;
  const from = (who: Mate) => ({ by: TEAM[who].name, hue: TEAM[who].hue, at: now - 60_000 * ago-- });
  /** A teammate's voter key in this box. Not a real device, so nobody's own vote collides with it. */
  const key = (who: Mate) => voterKey(`starter-${who}`, boxId);

  const today = Math.floor(now / DAY_MS);
  const dateIn = (days: number) => new Date((today + days) * DAY_MS).toISOString().slice(0, 10);
  /** UTC minute of hh:mm UTC some days out. 17:00 UTC is morning in the Americas, evening in Europe. */
  const at = (days: number, hh: number, mm = 0) => (today + days) * 1440 + hh * 60 + mm;
  const timed = (i: number, title: string, who: Mate, days: number, hh: number, mins: number) => {
    const { by, hue } = from(who);
    return { id: sub("evt", i), title, day: null, start: at(days, hh), end: at(days, hh) + mins, by, hue };
  };
  const allDay = (i: number, title: string, who: Mate, days: number) => {
    const { by, hue } = from(who);
    return { id: sub("evt", i), title, day: dateIn(days), start: null, end: null, by, hue };
  };

  /** Free half hours, as [day, from hour, to hour] in UTC. */
  const free = (who: Mate, spans: [number, number, number][]) => {
    const bits = Array.from({ length: FREE_SLOTS }, () => false);
    for (const [day, fromH, toH] of spans) {
      for (let m = at(day, fromH); m < at(day, toH); m += 30) {
        const i = slotAt(today, m);
        if (i >= 0) bits[i] = true;
      }
    }
    return { [key(who)]: { name: TEAM[who].name, hue: TEAM[who].hue, slots: bitsToSlots(bits) } };
  };

  const vote = (who: Mate, ...picks: string[]) => ({
    [key(who)]: { name: TEAM[who].name, hue: TEAM[who].hue, picks },
  });

  return [
    {
      ...frame("swelcome", { x: 0, y: 0, w: 4, h: 3 }, "tamago"),
      kind: "note",
      size: "m",
      text: "Welcome to the bento 🍱\n\nEvery widget here is shared live. \n\nDrag one by its body, pull a corner to resize, and try them all.\n\nAdd more from the + in the corner.",
    },
    {
      ...frame("stodo", { x: 4, y: 2, w: 5, h: 3 }, "edamame", "Before the outing"),
      kind: "todo",
      items: [
        ["Pick a date", true, "mochi"],
        ["Send the invite", true, "yuzu"],
        ["Book the place", false, "mochi"],
        ["Order bento boxes", false, "kombu"],
        ["Plan a couple of games", false, "tofu"],
        ["Collect RSVPs by Friday", false, "yuzu"],
      ].map(([text, done, who], i) => {
        const { by, at: when } = from(who as Mate);
        return { id: sub("item", i + 1), text: text as string, done: done as boolean, by, at: when };
      }),
    },
    {
      ...frame("sbudget", { x: 4, y: 0, w: 3, h: 2 }, "tamago", "Outing budget"),
      kind: "budget",
      currency: "USD",
      amount: 42_000,
      log: [
        { do: "adjust", amount: -8_000, ...from("yuzu") },
        { do: "set", amount: 50_000, ...from("mochi") },
      ],
    },
    {
      ...frame("stimer", { x: 7, y: 0, w: 2, h: 2 }, "ume", "Quick standup"),
      kind: "timer",
      duration: TIMER_DEFAULT_MS,
      endsAt: null,
      left: TIMER_DEFAULT_MS,
    },
    {
      ...frame("spoll", { x: 9, y: 0, w: 3, h: 4 }, "nori", "Lunch options?"),
      kind: "poll",
      multi: false,
      options: ["Ramen", "Sushi", "Tacos", "Burgers", "Stir fry"].map((text, i) => ({
        id: sub("opt", i + 1),
        text,
      })),
      votes: {
        ...vote("mochi", sub("opt", 2)),
        ...vote("yuzu", sub("opt", 1)),
        ...vote("kombu", sub("opt", 2)),
        ...vote("tofu", sub("opt", 3)),
      },
    },
    {
      ...frame("sideas", { x: 0, y: 3, w: 4, h: 5 }, "shiso", "What should we do?"),
      kind: "ideas",
      ideas: (
        [
          ["Picnic in the park", "mochi", ["yuzu", "kombu", "tofu"]],
          ["Karaoke night", "yuzu", ["mochi", "tofu"]],
          ["Cooking class", "kombu", ["yuzu"]],
          ["Escape room", "tofu", ["kombu", "mochi"]],
          ["Board game café", "yuzu", []],
          ["Sunset hike", "kombu", ["tofu"]],
        ] as const
      ).map(([text, who, votes], i) => ({
        id: sub("idea", i + 1),
        text,
        ...from(who),
        votes: votes.map(key),
      })),
    },
    {
      ...frame("sasks", { x: 4, y: 5, w: 5, h: 3 }, "sake", "Team asks"),
      kind: "asks",
      people: (
        [
          [
            "Mochi",
            [
              ["Share the slides", "yuzu", false],
              ["Book the picnic spot", "kombu", false],
              ["Send the calendar invite", "tofu", true],
            ],
          ],
          [
            "Yuzu",
            [
              ["Bring the tea", "mochi", false],
              ["Check who has allergies", "tofu", false],
            ],
          ],
          ["Kombu", [["Pick up the bento order", "mochi", false]]],
          ["Tofu", [["Make a playlist", "yuzu", true]]],
        ] as const
      ).map(([name, asks], p) => ({
        id: sub("pers", p + 1),
        name,
        asks: asks.map(([text, who, done], a) => ({
          id: sub(`ask${p + 1}x`, a + 1),
          text,
          done,
          ...from(who),
        })),
      })),
    },
    {
      ...frame("stips", { x: 9, y: 4, w: 3, h: 4 }, "nori"),
      kind: "note",
      size: "m",
      text: "Tips\n\n• Share the link: everyone sees changes as they happen.\n\n• Set new visitor permissions to view/edit\n\n• Password protect the link, or allow anyone with it to join\n",
    },
    {
      ...frame("scalendar", { x: 0, y: 8, w: 7, h: 5 }, "tamago", "Plans"),
      kind: "calendar",
      view: { mode: "month", anchor: dateIn(0) },
      events: [
        // A few that already happened, at fixed offsets from today.
        timed(9, "Outing brainstorm", "mochi", -10, 18, 60),
        allDay(10, "Mochi out", "mochi", -4),
        timed(11, "Weekly sync", "tofu", -6, 18, 45),
        timed(12, "Lunch & learn", "kombu", -2, 20, 60),
        allDay(1, "Venue booking due", "mochi", 1),
        timed(13, "Weekly sync", "tofu", 1, 18, 45),
        timed(2, "Kickoff call", "mochi", 2, 17, 30),
        timed(3, "Team lunch", "kombu", 3, 20, 60),
        allDay(4, "Team outing", "yuzu", 5),
        timed(5, "Weekly sync", "tofu", 8, 18, 45),
        timed(6, "Outing retro", "yuzu", 9, 17, 60),
        allDay(7, "Yuzu's birthday 🎂", "tofu", 12),
        timed(8, "Weekly sync", "tofu", 15, 18, 45),
      ],
    },
    {
      ...frame("sfree", { x: 7, y: 8, w: 5, h: 5 }, "edamame", "When are we free?"),
      kind: "freetimes",
      startDay: today,
      people: {
        ...free("mochi", [
          [1, 17, 20],
          [2, 19, 23],
          [4, 17, 21],
        ]),
        ...free("yuzu", [
          [1, 18, 21],
          [3, 17, 19],
          [4, 19, 23],
        ]),
        ...free("kombu", [
          [1, 19, 22],
          [2, 17, 19],
          [4, 18, 20],
          [5, 20, 23],
        ]),
      },
    },
  ];
}
