import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';
import { toast } from '../lib/overlays';
import { Actions, Async, Badge, Button, Field, Modal, PageTitle, useAction } from '../lib/ui';

function PasswordCard() {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [save, busy] = useAction(async () => { await post('/auth/password', { currentPassword: cur, newPassword: nw }); toast('Password changed'); setCur(''); setNw(''); });
  return (
    <section className="card">
      <h2>Change my password</h2>
      <form onSubmit={save}>
        <Field label="Current password" htmlFor="cur"><input id="cur" type="password" className="input" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password (8+ characters)" htmlFor="new"><input id="new" type="password" className="input" autoComplete="new-password" minLength={8} required value={nw} onChange={(e) => setNw(e.target.value)} /></Field>
        <button className="btn btn-primary" disabled={busy}>Change password</button>
      </form>
    </section>
  );
}

const NUM = [
  ['taxPercent', 'Tax on bills (%)', { min: 0, max: 100 }], ['staffMaxDiscountPercent', 'Max discount for staff (%)', { min: 0, max: 100 }],
  ['defaultLowStockThreshold', 'Default low-stock alert (copies)', { min: 0 }], ['restockLookbackDays', 'Restock: sales analysed over (days)', { min: 7, max: 365 }],
  ['restockCoverDays', 'Restock: order to cover (days)', { min: 1, max: 365 }], ['restockDefaultLeadTimeDays', 'Restock: default lead time (days)', { min: 0 }],
];

function ShopCard() {
  const { settings, setSettings } = useAuth();
  const [f, setF] = useState(settings);
  useEffect(() => setF(settings), [settings]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [save, busy] = useAction(async () => {
    const body = { shopName: f.shopName, shopAddress: f.shopAddress, currencySymbol: f.currencySymbol };
    NUM.forEach(([k]) => { body[k] = Number(f[k]); });
    setSettings(await put('/settings', body)); toast('Settings saved');
  });
  return (
    <section className="card">
      <h2>Shop &amp; business rules</h2>
      <form onSubmit={save}>
        <Field label="Shop name (printed on receipts)" htmlFor="shopName"><input id="shopName" className="input" maxLength={100} value={f.shopName ?? ''} onChange={set('shopName')} /></Field>
        <Field label="Address" htmlFor="shopAddress"><input id="shopAddress" className="input" maxLength={300} value={f.shopAddress ?? ''} onChange={set('shopAddress')} /></Field>
        <div className="grid grid-cols-2 gap-x-2.5">
          <Field label="Currency symbol" htmlFor="currencySymbol"><input id="currencySymbol" className="input" maxLength={5} value={f.currencySymbol ?? ''} onChange={set('currencySymbol')} /></Field>
          {NUM.map(([k, l, extra]) => <Field key={k} label={l} htmlFor={k}><input id={k} type="number" step="any" className="input font-mono" value={f[k] ?? ''} onChange={set(k)} {...extra} /></Field>)}
        </div>
        <p className="text-muted text-[.85rem] mb-2">Tax and discount changes apply to new bills and orders only; existing bills keep what they were saved with.</p>
        <button className="btn btn-primary" disabled={busy}>Save settings</button>
      </form>
    </section>
  );
}

function UserDialog({ reset, onClose, onDone }) {
  const [f, setF] = useState({ username: '', fullName: '', password: '', role: 'staff' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = async () => {
    if (reset) { await post(`/users/${reset.id}/password`, { newPassword: f.password }); toast('Password reset'); } else { await post('/users', f); toast('User created'); }
    onDone?.(); onClose();
  };
  return (
    <Modal title={reset ? `Reset password: ${reset.username}` : 'Add user'} onClose={onClose}>
      {!reset && <div className="grid grid-cols-2 gap-x-2.5">
        <Field label="Username" htmlFor="un"><input id="un" className="input" maxLength={50} autoComplete="off" value={f.username} onChange={set('username')} /></Field>
        <Field label="Full name" htmlFor="fn"><input id="fn" className="input" maxLength={100} value={f.fullName} onChange={set('fullName')} /></Field>
      </div>}
      <div className="grid grid-cols-2 gap-x-2.5">
        <Field label="Password (8+ characters)" htmlFor="pwd"><input id="pwd" type="password" className="input" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        {!reset && <Field label="Role" htmlFor="rl"><select id="rl" className="input" value={f.role} onChange={set('role')}><option value="staff">Staff</option><option value="owner">Owner</option></select></Field>}
      </div>
      {reset && <p className="text-muted text-[.85rem]">The user will be signed out everywhere.</p>}
      <Actions><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go}>{reset ? 'Reset' : 'Create user'}</Button></Actions>
    </Modal>
  );
}

function UsersCard() {
  const { user: me } = useAuth();
  const st = useLoad(() => get('/users'), []);
  const [dlg, setDlg] = useState(null); // 'add' | { reset: user }
  return (
    <section className="card mt-3.5">
      <div className="flex justify-between items-center mb-1.5"><h2 className="!mb-0">Users</h2><button className="btn" onClick={() => setDlg('add')}>+ Add user</button></div>
      <Async state={st}>
        {(us) => (
          <div className="table-wrap"><table className="ledger">
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>{us.map((u) => (
              <tr key={u.id}><td><strong>{u.fullName}</strong><div className="text-muted text-[.8rem] font-mono">{u.username}</div></td><td>{u.role}</td>
                <td>{u.active ? <Badge kind="ok">active</Badge> : <Badge kind="bad">disabled</Badge>}</td>
                <td className="whitespace-nowrap"><button className="btn btn-sm" onClick={() => setDlg({ reset: u })}>Reset password</button>{' '}
                  {u.id !== me.id && <Button small variant={u.active ? 'danger' : ''} onClick={async () => { await post(`/users/${u.id}/active`, { active: !u.active }); st.reload(); }}>{u.active ? 'Disable' : 'Enable'}</Button>}</td></tr>))}
            </tbody>
          </table></div>
        )}
      </Async>
      {dlg && <UserDialog reset={dlg.reset} onClose={() => setDlg(null)} onDone={st.reload} />}
    </section>
  );
}

export default function Settings() {
  const { isOwner } = useAuth();
  return (
    <div>
      <PageTitle>Settings</PageTitle>
      <div className="grid lg:grid-cols-2 gap-3 items-start"><PasswordCard />{isOwner && <ShopCard />}</div>
      {isOwner && <UsersCard />}
    </div>
  );
}
