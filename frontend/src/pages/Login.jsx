import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useAction, Field } from '../lib/ui';

export default function Login() {
  const { login } = useAuth();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [submit, busy] = useAction(async () => {
    setErr('');
    try { await login(u, p); } catch (e) { setErr(e.message); }
  });
  return (
    <div className="max-w-[340px] mx-auto mt-[12vh] px-3">
      <form className="card shadow-dialog !p-4" onSubmit={submit}>
        <h1 className="!text-[2.2rem] mb-4">Sign in</h1>
        <Field label="Username" htmlFor="u"><input id="u" className="input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required /></Field>
        <Field label="Password" htmlFor="p"><input id="p" type="password" className="input" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
        {err && <div className="notice notice-bad">{err}</div>}
        <button className="btn btn-primary w-full" disabled={busy}>Sign in</button>
      </form>
    </div>
  );
}
