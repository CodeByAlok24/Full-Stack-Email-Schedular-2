import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { previewText } from "../../lib/api";
import type { Email } from "../../types/email";

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function EmailRow({ email, variant }: { email: Email; variant: "scheduled" | "sent" }) {
  const nav = useNavigate();
  const [star, setStar] = useState(false);

  function open() {
    nav(`/email/${email.id}`, { state: { from: variant === "scheduled" ? "/" : "/sent" } });
  }

  return (
    <div className="flex items-center gap-4 border-b border-slate-100 px-4 py-3 hover:bg-slate-50">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={open}>
        <div className="text-sm text-slate-900 truncate">
          To: <span className="font-medium">{email.recipient}</span>
          <span
            className={`ml-3 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
              variant === "scheduled" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
            }`}
          >
            {variant === "scheduled" ? fmt(email.sendAt) : email.status}
          </span>
          <span className="ml-2 text-slate-500">
            {email.attachments && email.attachments.length > 0 && (
              <span className="mr-1 text-slate-400" title={`${email.attachments.length} attachment(s)`}>📎</span>
            )}
            {email.subject} - {previewText(email.body, 60)}
          </span>
        </div>
      </button>
      <button
        type="button"
        aria-label="Star"
        onClick={() => setStar((s) => !s)}
        className={star ? "text-amber-500" : "text-slate-300 hover:text-amber-500"}
      >
        {star ? "★" : "☆"}
      </button>
      {email.previewUrl && (
        <a
          href={email.previewUrl}
          target="_blank"
          rel="noreferrer"
          title="Open in Ethereal Fake SMTP"
          className="text-xs text-emerald-600 hover:text-emerald-800 underline px-2 py-0.5 rounded bg-emerald-50 shrink-0"
        >
          Ethereal ↗
        </a>
      )}
      <button type="button" onClick={open} className="text-slate-300 hover:text-emerald-600 text-xs" title="Open">
        →
      </button>
    </div>
  );
}
