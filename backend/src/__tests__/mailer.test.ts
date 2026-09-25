import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendEmail } from "../lib/mailer";

describe("mailer", () => {
  it("sendEmail throws for fail-test@ recipients", async () => {
    await expect(
      sendEmail({ from: "test@test.com", to: "fail-test@domain.com", subject: "t", html: "<p>hi</p>" }),
    ).rejects.toThrow("simulated SMTP failure");
  });

  it("sendEmail returns a mocked result for @loadtest. recipients", async () => {
    const result = await sendEmail({
      from: "test@test.com",
      to: "bulk-load-123@loadtest.ex.com",
      subject: "Load test",
      html: "<p>hi</p>",
    });
    expect(result.messageId).toMatch(/^mock-/);
    expect(result.previewUrl).toBe(false);
  });

  it("sendEmail returns a mocked result for bulk-load- recipients", async () => {
    const result = await sendEmail({
      from: "test@test.com",
      to: "bulk-load-456@loadtest.ex.com",
      subject: "Load test",
      html: "<p>hi</p>",
    });
    expect(result.messageId).toMatch(/^mock-/);
    expect(result.previewUrl).toBe(false);
  });

  it("sendEmail throws on missing required fields", async () => {
    await expect(
      sendEmail({ from: "", to: "", subject: "", html: "" }),
    ).rejects.toThrow();
  });
});
