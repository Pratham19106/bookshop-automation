import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAction, Field } from '../lib/ui';
import { Zap, AlertTriangle, Building2, LogIn } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [submit, busy] = useAction(async () => {
    setErr('');
    try {
      await login(u, p);
    } catch (e) {
      setErr(e.message);
    }
  });

  const fillDemo = (username, password) => {
    setU(username);
    setP(password);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-ink font-sans flex flex-col justify-center px-4 py-10 text-base">
      <div className="max-w-[440px] w-full mx-auto animate-stamp">
        <div className="bg-white border-2 border-black p-7 shadow-hard-lg relative">
          {/* Badge Decorator */}
          <div className="absolute -top-3.5 -right-3.5 bg-[#CCFF00] text-black font-mono font-black text-xs px-3 py-1 border-2 border-black shadow-[2px_2px_0px_0px_#1A1A1A] uppercase rotate-2 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" /> Till Ready
          </div>

          <div className="flex items-center justify-between pb-3.5 mb-5 border-b-2 border-black">
            <div>
              <div className="text-xs uppercase tracking-wider font-mono font-bold text-[#4F46E5]">
                Point-of-Sale Access
              </div>
              <h1 className="!border-0 !mb-0 text-3xl font-serif font-black text-black">Sign in</h1>
            </div>
            <span className="inline-block px-2.5 py-1 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">
              API Online
            </span>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Username" htmlFor="u">
              <input
                id="u"
                className="input font-mono text-base py-2.5"
                value={u}
                onChange={(e) => setU(e.target.value)}
                autoComplete="username"
                placeholder="e.g. owner or staff"
                autoFocus
                required
              />
            </Field>

            <Field label="Password" htmlFor="p">
              <input
                id="p"
                type="password"
                className="input font-mono text-base py-2.5"
                value={p}
                onChange={(e) => setP(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••••••"
                required
              />
            </Field>

            {err && (
              <div className="notice notice-bad animate-slide-up text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span>{err}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full py-3 text-base uppercase tracking-wider mt-2 flex items-center justify-center gap-2"
              disabled={busy}
            >
              <LogIn className="w-4 h-4" />
              {busy ? 'Authenticating…' : 'Sign in to Terminal →'}
            </button>
          </form>

          {/* Demo Filler Buttons Outside Form */}
          <div className="mt-5 pt-3.5 border-t-2 border-black">
            <div className="text-xs uppercase font-mono font-bold text-muted mb-2">
              Quick Credential Filler:
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => fillDemo('Pratham19106', 'Password123')}
                className="btn btn-sm bg-[#FAF5FF] hover:bg-[#F3E8FF] border border-[#9333EA] text-[#6B21A8] font-mono text-xs font-bold py-1.5"
              >
                Owner (Full)
              </button>
              <button
                type="button"
                onClick={() => fillDemo('worker', 'Worker123')}
                className="btn btn-sm bg-[#F0FDF4] hover:bg-[#DCFCE7] border border-[#16A34A] text-[#15803D] font-mono text-xs font-bold py-1.5"
              >
                Worker (Staff)
              </button>
            </div>
          </div>

          {/* Multi-Tenant Registration Link */}
          <div className="mt-5 pt-3.5 border-t-2 border-black">
            <Link
              to="/register"
              className="w-full py-3 bg-[#FAF5FF] hover:bg-[#F3E8FF] border-2 border-[#9333EA] text-[#6B21A8] font-mono font-bold text-sm text-center shadow-[2px_2px_0px_0px_#9333EA] transition-all flex items-center justify-center gap-2 no-underline"
            >
              <Building2 className="w-4 h-4" /> Onboard New Chain: Register Business →
            </Link>
          </div>

          <div className="mt-4 text-center">
            <Link to="/landing" className="text-sm font-mono font-bold text-[#4F46E5] hover:underline">
              ← Return to Platform Overview
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
