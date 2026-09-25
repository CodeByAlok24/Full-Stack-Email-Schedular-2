import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { EmailRow } from "../components/email/EmailRow";
import { api } from "../lib/api";
import type { Email, User } from "../types/email";

export default function Dashboard({ variant }: { variant: "scheduled" | "sent" }) {
  const nav = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [counts, setCounts] = useState({ scheduled: 0, sent: 0 });
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.me().then((r) => setUser(r.user as User | null)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const fetcher = variant === "scheduled" ? api.scheduled : api.sent;
    fetcher()
      .then((r) => {
        const list = r.data ?? [];
        setEmails(list);
        setCounts((c) => ({ ...c, [variant]: list.length }));
      })
      .catch(() => {
        setEmails([]);
        setError("Unable to load emails. Please sign in again.");
      })
      .finally(() => setLoading(false));

    const otherFetcher = variant === "scheduled" ? api.sent : api.scheduled;
    const otherKey = variant === "scheduled" ? "sent" : "scheduled";
    otherFetcher()
      .then((r) => {
        const list = r.data ?? [];
        setCounts((c) => ({ ...c, [otherKey]: list.length }));
      })
      .catch(() => {});
  }, [variant]);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const filtered = emails.filter(
    (e) =>
      !q ||
      e.recipient.toLowerCase().includes(q.toLowerCase()) ||
      e.subject.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-white flex">
      <Sidebar user={user} onCompose={() => nav("/compose")} counts={counts} variant={variant} />
      <main className="flex-1 min-w-0">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-4">
          <div className="flex-1 flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2">
            <span className="text-slate-400">⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>
          <button type="button" className="text-slate-400 text-sm hover:text-slate-600" title="Filter">▽</button>
          <button type="button" onClick={load} className="text-slate-400 text-sm hover:text-emerald-600" title="Refresh">↻</button>
        </div>
        <div className="divide-y divide-slate-100">
          {loading && <div className="p-8 text-center text-sm text-slate-500">Loading…</div>}
          {error && (
            <div className="p-8 text-center text-sm text-red-600">
              {error}{" "}
              <button type="button" onClick={load} className="underline">Retry</button>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="p-12 text-center text-sm text-slate-500">
              {variant === "scheduled" ? "No scheduled emails yet." : "No sent emails yet."}
            </div>
          )}
          {!loading && !error && filtered.map((e) => <EmailRow key={e.id} email={e} variant={variant} />)}
        </div>
      </main>
    </div>
  );
}
