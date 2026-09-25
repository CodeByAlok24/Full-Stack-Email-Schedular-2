import { describe, it, expect } from "vitest";
import { sanitizeBody } from "../lib/sanitize";

describe("sanitizeBody", () => {
  it("strips script/style/iframe and event attrs", () => {
    const out = sanitizeBody('<p>hi</p><script>alert(1)</script><div onclick="x()">x</div>');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("hi");
  });

  it("keeps allowlisted tags and links", () => {
    const out = sanitizeBody('<p><b>bold</b> <a href="https://example.com">link</a></p>');
    expect(out).toMatch(/<b>bold<\/b>/);
    expect(out).toMatch(/href="https:\/\/example.com"/);
  });

  it("drops javascript: hrefs", () => {
    const out = sanitizeBody('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });
});
