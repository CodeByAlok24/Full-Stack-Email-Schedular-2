import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Compose from "./pages/Compose";
import EmailDetail from "./pages/EmailDetail";
import { api } from "./lib/api";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [state, setState] = useState<"loading" | "authed" | "guest">("loading");

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((r) => {
        if (cancelled) return;
        setState(r.user ? "authed" : "guest");
      })
      .catch(() => {
        if (cancelled) return;
        setState("guest");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") return <div className="min-h-screen bg-white p-8 text-sm text-slate-500">Loading…</div>;
  if (state === "guest") return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Dashboard variant="scheduled" /></RequireAuth>} />
        <Route path="/sent" element={<RequireAuth><Dashboard variant="sent" /></RequireAuth>} />
        <Route path="/compose" element={<RequireAuth><Compose /></RequireAuth>} />
        <Route path="/email/:id" element={<RequireAuth><EmailDetail /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
