import { describe, it, expect } from "vitest";

function shouldSend(status: string): boolean {
  return status !== "sent";
}

describe("idempotency guard", () => {
  it("skips already-sent rows", () => {
    expect(shouldSend("sent")).toBe(false);
  });
  it("sends pending rows", () => {
    expect(shouldSend("pending")).toBe(true);
  });
  it("retries failed rows (will be marked failed after exhausting attempts)", () => {
    expect(shouldSend("failed")).toBe(true);
  });
});
