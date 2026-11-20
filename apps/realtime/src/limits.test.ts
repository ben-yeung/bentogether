import { describe, expect, it } from "vitest";
import { TokenBucket, ipKey, isQuotaError, originAllowed } from "./limits";

describe("TokenBucket", () => {
  it("spends the burst, then refills over time", () => {
    const b = new TokenBucket(2, 3, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(500)).toBe(true);
    expect(b.take(500)).toBe(false);
  });
});

describe("ipKey", () => {
  it("keeps IPv4 as is", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
  });
  it("cuts IPv6 to its /64, however it's written", () => {
    const key = "2001:db8:0:1::/64";
    expect(ipKey("2001:db8:0:1::1")).toBe(key);
    expect(ipKey("2001:0db8:0000:0001:aaaa:bbbb:cccc:dddd")).toBe(key);
    expect(ipKey("2001:DB8:0:1:ffff::")).toBe(key);
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
  });
});

describe("originAllowed", () => {
  it("matches exact origins only when there's no wildcard", () => {
    const list = "https://bentogether.vercel.app";
    expect(originAllowed("https://bentogether.vercel.app", list)).toBe(true);
    expect(originAllowed("https://bentogether-evil.vercel.app", list)).toBe(false);
    expect(originAllowed(null, list)).toBe(false);
  });
});

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
