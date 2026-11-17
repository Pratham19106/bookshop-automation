import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAction, Field } from '../lib/ui';
import { AlertTriangle, BookOpen } from 'lucide-react';

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

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-ink font-sans flex flex-col justify-center px-4 py-10 text-base">
      <div className="max-w-[400px] w-full mx-auto">
        <div className="bg-white border-2 border-black p-7 shadow-hard-lg">
          <div className="flex items-center gap-2.5 pb-3.5 mb-5 border-b-2 border-black">
            <span className="w-8 h-8 bg-[#1A1A1A] text-white flex items-center justify-center"><BookOpen className="w-4 h-4" /></span>
            <h1 className="!border-0 !mb-0 text-3xl font-serif font-black text-black">Sign in</h1>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Username" htmlFor="u">
              <input id="u" className="input text-base py-2.5" value={u} onChange={(e) => setU(e.target.value)}
                autoComplete="username" autoFocus required />
            </Field>
            <Field label="Password" htmlFor="p">
              <input id="p" type="password" className="input text-base py-2.5" value={p} onChange={(e) => setP(e.target.value)}
                autoComplete="current-password" required />
            </Field>

            {err && (
              <div className="notice notice-bad text-sm font-semibold flex items-center gap-2" role="alert">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span>{err}</span>
              </div>
            )}

            <button type="submit" className="btn btn-primary w-full py-3 text-base mt-2" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 pt-3.5 border-t-2 border-black text-sm text-center">
            New bookshop? <Link to="/register" className="font-semibold underline">Register your business</Link>
          </p>
          <p className="mt-3 text-sm text-center"><Link to="/landing" className="font-semibold underline">Back to home</Link></p>
        </div>
      </div>
    </div>
  );
}
