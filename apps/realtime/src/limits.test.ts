import { describe, expect, it } from "vitest";
import { isQuotaError } from "./limits";

describe("isQuotaError", () => {
  it("recognizes Cloudflare's free-tier quota errors", () => {
    for (const message of [
      "Exceeded allowed volume of requests in Durable Objects free tier.",
      "Exceeded allowed rows written in Durable Objects free tier.",
      "Exceeded allowed duration in Durable Objects free tier.",
      "Durable Object storage limit exceeded",
    ]) {
      expect(isQuotaError(new Error(message)), message).toBe(true);
    }
  });

  it("leaves other errors alone", () => {
    expect(isQuotaError(new Error("Network connection lost."))).toBe(false);
    expect(isQuotaError(new TypeError("x is undefined"))).toBe(false);
    expect(isQuotaError("boom")).toBe(false);
  });
});
