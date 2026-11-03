import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAction, Field } from '../lib/ui';

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
    <div className="min-h-screen bg-[#FAF9F5] text-ink font-sans flex flex-col justify-center px-4 py-8">
      <div className="max-w-[420px] w-full mx-auto animate-stamp">
        <div className="bg-white border-2 border-black p-6 shadow-hard-lg relative">
          {/* Badge Decorator */}
          <div className="absolute -top-3.5 -right-3.5 bg-[#CCFF00] text-black font-mono font-black text-[.72rem] px-2.5 py-1 border-2 border-black shadow-[2px_2px_0px_0px_#1A1A1A] uppercase rotate-2">
            Till Ready ⚡
          </div>

          <div className="flex items-center justify-between pb-3 mb-4 border-b-2 border-black">
            <div>
              <div className="text-[.7rem] uppercase tracking-wider font-mono font-bold text-[#4F46E5]">
                Point-of-Sale Access
              </div>
              <h1 className="!border-0 !mb-0 text-2xl font-serif font-black text-black">Sign in</h1>
            </div>
            <span className="inline-block px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] font-mono text-[.72rem] font-bold border border-[#15803D]">
              API Online
            </span>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <Field label="Username" htmlFor="u">
              <input
                id="u"
                className="input font-mono"
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
                className="input font-mono"
                value={p}
                onChange={(e) => setP(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••••••"
                required
              />
            </Field>

            {err && (
              <div className="notice notice-bad animate-slide-up text-xs font-semibold">
                ⚠ {err}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full py-2.5 text-sm uppercase tracking-wider mt-2"
              disabled={busy}
            >
              {busy ? 'Authenticating…' : 'Sign in to Terminal →'}
            </button>
          </form>

          {/* Demo Filler Buttons Outside Form */}
          <div className="mt-4 pt-3 border-t-2 border-black">
            <div className="text-[.7rem] uppercase font-mono font-bold text-muted mb-2">
              Quick Credential Filler:
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => fillDemo('Pratham19106', 'Password123')}
                className="btn btn-sm bg-[#FAF5FF] hover:bg-[#F3E8FF] border border-[#9333EA] text-[#6B21A8] font-mono text-[.72rem]"
              >
                Owner (Full)
              </button>
              <button
                type="button"
                onClick={() => fillDemo('worker', 'Worker123')}
                className="btn btn-sm bg-[#F0FDF4] hover:bg-[#DCFCE7] border border-[#16A34A] text-[#15803D] font-mono text-[.72rem]"
              >
                Worker (Staff)
              </button>
            </div>
          </div>

          <div className="mt-4 text-center">
            <Link to="/landing" className="text-xs font-mono font-bold text-[#4F46E5] hover:underline">
              ← Return to Platform Overview
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
