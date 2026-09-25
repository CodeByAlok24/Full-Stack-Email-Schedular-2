import sanitizeHtml from "sanitize-html";

export function sanitizeBody(dirty: string): string {
  return sanitizeHtml(dirty ?? "", {
    allowedTags: [
      "p",
      "br",
      "b",
      "strong",
      "i",
      "em",
      "u",
      "s",
      "strike",
      "a",
      "ul",
      "ol",
      "li",
      "blockquote",
      "div",
      "span",
    ],
    allowedAttributes: { a: ["href", "title", "target"] },
    allowedSchemes: ["http", "https", "mailto"],
  });
}
