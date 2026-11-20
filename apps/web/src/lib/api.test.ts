import { afterEach, describe, expect, it, vi } from "vitest";
import { createBox, getBox, OverCapacity, Unreachable } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("capacity errors", () => {
  it("a 503 from the server is OverCapacity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "over_capacity" }, { status: 503 })),
    );
    await expect(getBox("box12345")).rejects.toBeInstanceOf(OverCapacity);
    await expect(
      createBox({ title: "", options: { cursors: true, autoPack: true }, starter: false }),
    ).rejects.toBeInstanceOf(OverCapacity);
  });

  it("a network failure is Unreachable and mentions demo capacity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = await getBox("box12345").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Unreachable);
    expect((err as Error).message).toMatch(/demo capacity/);
  });
});
