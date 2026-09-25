import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import type { User } from "../../types/email";

export function Sidebar({
  user,
  onCompose,
  counts,
  variant,
}: {
  user: User | null;
  onCompose: () => void;
  counts: { scheduled: number; sent: number };
  variant: "scheduled" | "sent";
}) {
  return (
    <aside className="w-[260px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
      <div className="px-4 py-4">
        <div className="text-xl font-bold tracking-tight">Email Schedule</div>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 p-2.5">
          <img src={user?.avatarUrl || "https://i.pravatar.cc/100?img=12"} alt="" className="h-8 w-8 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{user?.name ?? "Oliver Brown"}</div>
            <div className="text-xs text-slate-500 truncate">{user?.email ?? "oliver.brown@domain.io"}</div>
          </div>
          <span className="text-slate-400">▾</span>
        </div>
        <button
          type="button"
          onClick={async () => {
            try { await api.logout(); } catch {}
            window.location.href = "/login";
          }}
          className="mt-1 w-full text-left text-xs text-slate-400 hover:text-slate-600 underline px-1"
        >
          Logout
        </button>
        <button
          type="button"
          onClick={onCompose}
          className="mt-4 flex w-full justify-center rounded-full border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
        >
          Compose
        </button>
        <div className="mt-6 text-[10px] font-semibold tracking-widest text-slate-400">CORE</div>
        <nav className="mt-2 flex flex-col gap-1">
          <NavLink
            to="/"
            end
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
              variant === "scheduled" ? "bg-emerald-50 text-emerald-900" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Scheduled
            </span>
            <span className="text-xs">{counts.scheduled}</span>
          </NavLink>
          <NavLink
            to="/sent"
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
              variant === "sent" ? "bg-emerald-50 text-emerald-900" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22 11 13 2 9l20-7z" />
              </svg>
              Sent
            </span>
            <span className="text-xs">{counts.sent}</span>
          </NavLink>
        </nav>
      </div>
    </aside>
  );
}
