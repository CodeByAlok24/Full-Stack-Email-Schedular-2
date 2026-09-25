import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, attachmentUrl, sanitizeEmailHtml } from "../lib/api";
import type { Email } from "../types/email";

function fmt(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export default function EmailDetail() {
  const { id } = useParams();
  const loc = useLocation();
  const backTo = (loc.state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [star, setStar] = useState(false);
  const [showTo, setShowTo] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api
      .email(id)
      .then((r) => setEmail(r.data))
      .catch(() => {
        setError("Email not found or you do not have access");
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="border-b border-slate-200 px-6 py-3 text-sm text-slate-500">← Loading…</div>
      </div>
    );
  }

  if (error || !email) {
    return (
      <div className="min-h-screen bg-white">
        <div className="border-b border-slate-200 px-6 py-3">
          <Link to={backTo} className="text-sm">← Back</Link>
        </div>
        <div className="p-12 text-center text-sm text-red-600">{error ?? "Not found"}</div>
      </div>
    );
  }

  const fromName = email.fromName || nameFromEmail(email.sender);
  const initial = (fromName[0] ?? "S").toUpperCase();
  const when = email.status === "sent" ? email.sentAt ?? email.sendAt : email.sendAt;
  const safeHtml = sanitizeEmailHtml(email.body);

  return (
    <div className="min-h-screen bg-white">
      <div className="border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4">
        <Link to={backTo} className="min-w-0 truncate text-sm font-medium hover:text-emerald-700">
          ← {email.subject || "(no subject)"}
        </Link>
        <div className="flex shrink-0 items-center gap-3 text-slate-400">
          <button
            type="button"
            aria-label="Star"
            onClick={() => setStar((s) => !s)}
            className={`p-1 hover:text-amber-500 ${star ? "text-amber-500" : ""}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={star ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button type="button" aria-label="Archive" className="p-1 hover:text-slate-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="5" rx="1" />
              <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
              <path d="M10 12h4" />
            </svg>
          </button>
          <button type="button" aria-label="Delete" className="p-1 hover:text-red-500">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
          <span className="text-xs text-slate-400">{fmt(when)}</span>
          <img src="https://i.pravatar.cc/100?img=12" alt="" className="h-7 w-7 rounded-full object-cover" />
        </div>
      </div>

      <article className="mx-auto max-w-3xl px-6 py-6">
        <header className="flex items-start gap-3">
          <div className="mt-0.5 h-9 w-9 shrink-0 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm font-medium">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <span className="font-semibold text-slate-900">{fromName}</span>{" "}
              <span className="text-slate-500">&lt;{email.sender}&gt;</span>
            </div>
            <button
              type="button"
              onClick={() => setShowTo((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              to me {showTo ? "▴" : "▾"}
            </button>
            {showTo && (
              <div className="mt-1 text-xs text-slate-500">to &lt;{email.recipient}&gt;</div>
            )}
          </div>
          <div className="shrink-0 text-xs text-slate-400">{fmt(when)}</div>
        </header>

        <div className="mt-5 text-sm leading-relaxed text-slate-800">
          {safeHtml.includes("<") ? (
            <div
              className="email-body space-y-3 [&_a]:text-emerald-700 [&_a]:underline [&_b]:font-semibold [&_strong]:font-semibold [&_i]:italic [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            email.body
              .split(/\n{2,}/)
              .map((block, i) => (
                <p key={i} className="whitespace-pre-wrap">{block}</p>
              ))
          )}
        </div>

        <div className="mt-6 rounded border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <div>From: {email.sender}</div>
          <div>To: {email.recipient}</div>
          <div>
            Status: <span className={email.status === "failed" ? "text-red-600 font-medium" : "text-emerald-700 font-medium"}>{email.status}</span>
            {" · "}
            {email.status === "sent" ? "Sent" : "Scheduled"}: {fmt(when)}
          </div>
        </div>

        {email.status === "sent" && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-emerald-900">
                  Delivered via Ethereal Fake SMTP
                </div>
                <div className="mt-0.5 text-xs text-emerald-700">
                  Per the ReachInbox assignment design, emails are routed through Ethereal fake SMTP so test sends never spam real recipient inboxes.
                </div>
              </div>
              {email.previewUrl ? (
                <a
                  href={email.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 transition"
                >
                  <span>Open in Ethereal Mail</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              ) : (
                <span className="text-xs text-slate-500 italic">
                  Ethereal fake SMTP delivery confirmed
                </span>
              )}
            </div>
          </div>
        )}

        {email.attachments && email.attachments.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">
              Attachments ({email.attachments.length})
            </div>
            <ul className="flex flex-wrap gap-2">
              {email.attachments.map((a, i) => (
                <li key={`${a.name}:${i}`}>
                  <a
                    href={attachmentUrl(email.id, i)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-64 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="min-w-0">
                      <span className="block max-w-40 truncate font-medium" title={a.name}>{a.name}</span>
                      <span className="text-slate-400">
                        {a.size < 1024
                          ? `${a.size} B`
                          : a.size < 1024 * 1024
                            ? `${(a.size / 1024).toFixed(1)} KB`
                            : `${(a.size / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {email.attachments.some((a) => a.type.startsWith("image/")) && (
              <div className="mt-3 flex flex-wrap gap-3">
                {email.attachments.map((a, i) =>
                  a.type.startsWith("image/") ? (
                    <img
                      key={`preview:${a.name}:${i}`}
                      src={attachmentUrl(email.id, i)}
                      alt={a.name}
                      className="max-h-40 max-w-64 rounded-md border border-slate-200 object-contain"
                    />
                  ) : null,
                )}
              </div>
            )}
          </div>
        )}
      </article>
    </div>
  );
}
