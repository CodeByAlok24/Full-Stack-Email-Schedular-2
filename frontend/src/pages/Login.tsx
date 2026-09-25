import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";

export default function Login() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const oauthError = params.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      if (isSignup) {
        await api.signup(email, password, name);
      } else {
        await api.login(email, password);
      }
      nav("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      try {
        const parsed = JSON.parse(msg);
        setError(parsed.message ?? msg);
      } catch {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-center text-xs text-slate-500">Sign in to manage your scheduled emails</p>

        {oauthError && (
          <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            Google sign-in was not completed. Please try again or use email sign-in below.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => window.location.assign(api.loginUrl())}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-emerald-700">G</span>
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-2">
          <div className="flex-1 border-t border-slate-200" />
          <span className="text-[11px] uppercase tracking-wider text-slate-400">or with email</span>
          <div className="flex-1 border-t border-slate-200" />
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-3">
          {isSignup && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your Name"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "Authenticating…" : isSignup ? "Create Account" : "Sign In with Email"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              setIsSignup(!isSignup);
              setError(null);
            }}
            className="text-xs text-emerald-700 hover:underline"
          >
            {isSignup ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
}
