const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const raw = text
    .split(/[\n,\r;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const r of raw) if (!seen.has(r)) { seen.add(r); uniq.push(r); }
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const e of uniq) (EMAIL_RE.test(e) ? valid : invalid).push(e);
  return { valid, invalid };
}
