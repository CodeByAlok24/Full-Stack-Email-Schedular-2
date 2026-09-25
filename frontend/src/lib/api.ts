import type { ApiResponse, ComposePayload, Email } from "../types/email";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export function attachmentUrl(emailId: string, index: number): string {
  return `${BASE}/api/emails/${encodeURIComponent(emailId)}/attachments/${index}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: { name: string; email: string; avatarUrl: string } | null }>("/api/auth/me"),
  loginUrl: () => `${BASE}/api/auth/google`,
  login: (email: string, password: string) =>
    request<{ user: { name: string; email: string; avatarUrl: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  signup: (email: string, password: string, name?: string) =>
    request<{ user: { name: string; email: string; avatarUrl: string } }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),
  logout: () => request<{ message: string }>("/api/auth/logout", { method: "POST" }),
  scheduled: () => request<ApiResponse<Email[]>>("/api/emails/scheduled"),
  sent: () => request<ApiResponse<Email[]>>("/api/emails/sent"),
  email: (id: string) => request<ApiResponse<Email>>(`/api/emails/${encodeURIComponent(id)}`),
  schedule: (payload: ComposePayload) =>
    request<ApiResponse<{ count: number }>>("/api/emails/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export function previewText(html: string, max = 80): string {
  const plain = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

export function sanitizeEmailHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style") el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}
