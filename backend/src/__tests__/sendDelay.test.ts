import { describe, expect, it } from "vitest";
import { effectiveSendGapMs, resolveDelayBetweenEmailsMs } from "../lib/sendDelay";

describe("send delay normalization", () => {
  it("converts delayBetweenEmails seconds to milliseconds", () => {
    expect(resolveDelayBetweenEmailsMs({ delayBetweenEmails: 2 }, 1000)).toBe(2000);
  });

  it("accepts the legacy millisecond field", () => {
    expect(resolveDelayBetweenEmailsMs({ delayMs: 2500 }, 1000)).toBe(2500);
  });

  it("uses the environment minimum when the request omits a delay", () => {
    expect(resolveDelayBetweenEmailsMs({}, 1000)).toBe(1000);
  });

  it("does not allow a request to lower the environment minimum", () => {
    expect(resolveDelayBetweenEmailsMs({ delayBetweenEmails: 0 }, 1000)).toBe(1000);
  });

  it("rejects invalid and oversized values", () => {
    expect(resolveDelayBetweenEmailsMs({ delayBetweenEmails: -1 }, 0)).toBeNull();
    expect(resolveDelayBetweenEmailsMs({ delayBetweenEmails: 3601 }, 0)).toBeNull();
  });

  it("normalizes persisted job values", () => {
    expect(effectiveSendGapMs(2000, 1000)).toBe(2000);
    expect(effectiveSendGapMs(undefined, 1000)).toBe(1000);
    expect(effectiveSendGapMs(500, 1000)).toBe(1000);
  });
});
