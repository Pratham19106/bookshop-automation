import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCached } from '../lib/hooks';
import { toast } from '../lib/overlays';
import { Actions, Async, Badge, Button, Field, Modal, PageTitle, useAction } from '../lib/ui';
import { useShop } from '../lib/shop';
import { Building2, MapPin, Phone, CheckCircle2, Plus } from 'lucide-react';

const ROLE_HELP = {
  staff: 'Billing, bills, phone orders, returns. Sees stock but not costs.',
  manager: 'Everything staff can do, plus titles, stock counts, suppliers, purchasing, restocking, reports for their shops.',
  owner: 'Everything, in every shop: people, shops, business settings, voiding bills.',
};

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
  ['taxPercent', 'Tax on bills (%)', { min: 0, max: 100 }],
  ['staffMaxDiscountPercent', 'Max discount for staff (%)', { min: 0, max: 100 }],
  ['managerMaxDiscountPercent', 'Max discount for managers (%)', { min: 0, max: 100 }],
  ['defaultLowStockThreshold', 'Default low-stock alert (copies)', { min: 0 }],
  ['returnWindowDays', 'Returns accepted within (days)', { min: 0, max: 90 }],
  ['restockLookbackDays', 'Restock: sales analysed over (days)', { min: 7, max: 365 }],
  ['restockCoverDays', 'Restock: order to cover (days)', { min: 1, max: 365 }],
  ['restockDefaultLeadTimeDays', 'Restock: default lead time (days)', { min: 0 }],
];

function BusinessRulesCard() {
  const { settings, setSettings } = useAuth();
  const [f, setF] = useState(settings);
  useEffect(() => setF(settings), [settings]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [save, busy] = useAction(async () => {
    const body = { currencySymbol: f.currencySymbol };
    NUM.forEach(([k]) => { body[k] = Number(f[k]); });
    setSettings(await put('/settings', body)); toast('Settings saved');
  });
  return (
    <section className="card">
      <h2>Business rules <span className="text-muted text-[.8rem] font-mono">(all shops)</span></h2>
      <form onSubmit={save}>
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

function ShopDialog({ shop, onClose, onDone }) {
  const [f, setF] = useState({ name: shop?.name || '', code: shop?.code || '', city: shop?.city || '', address: shop?.address || '', phone: shop?.phone || '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [go, busy] = useAction(async () => {
    if (!f.name.trim()) throw new Error('Shop name is required');
    const saved = shop ? await put(`/shops/${shop.id}`, f) : await post('/shops', f);
    toast(shop ? `Saved "${saved.name}"` : `Shop "${saved.name}" added (${saved.code})`);
    onDone?.(); onClose();
  });
  return (
    <Modal title={shop ? `Edit shop: ${shop.name}` : 'Add a shop'} onClose={onClose}>
      <form onSubmit={go}>
        <div className="grid sm:grid-cols-2 gap-x-2.5">
          <Field label="Shop name (printed on receipts) *" htmlFor="sh_name"><input id="sh_name" className="input" maxLength={100} value={f.name} onChange={set('name')} /></Field>
          <Field label="Code (blank = next free, e.g. S03)" htmlFor="sh_code"><input id="sh_code" className="input font-mono uppercase" maxLength={12} value={f.code} onChange={set('code')} /></Field>
          <Field label="City" htmlFor="sh_city"><input id="sh_city" className="input" maxLength={80} value={f.city} onChange={set('city')} /></Field>
          <Field label="Phone" htmlFor="sh_phone"><input id="sh_phone" className="input" maxLength={60} value={f.phone} onChange={set('phone')} /></Field>
        </div>
        <Field label="Address" htmlFor="sh_addr"><input id="sh_addr" className="input" maxLength={300} value={f.address} onChange={set('address')} /></Field>
        <Actions><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{shop ? 'Save' : 'Add shop'}</Button></Actions>
      </form>
    </Modal>
  );
}

function ShopsCard() {
  const { refreshUser } = useAuth();
  const { currentShop, selectShop } = useShop();
  const st = useCached(['admin', 'shops'], () => get('/shops'));
  const [dlg, setDlg] = useState(null); // 'add' | shop
  const reload = () => { st.reload(); refreshUser(); };
  const update = async (s, body, msg) => {
    try { await put(`/shops/${s.id}`, body); toast(msg); reload(); } catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <section className="card mt-3.5">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-3 pb-2 border-b-2 border-black">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-black" />
          <h2 className="!mb-0">Shops</h2>
          {st.data && <span className="badge badge-info font-mono font-bold">{st.data.length}</span>}
        </div>
        <button className="btn btn-primary shadow-[2px_2px_0px_0px_#1A1A1A] flex items-center gap-1.5" onClick={() => setDlg('add')}>
          <Plus className="w-4 h-4" /> Add shop
        </button>
      </div>
      <p className="text-muted text-xs font-mono mb-3">
        Each shop keeps its own stock, bills, phone orders and purchase orders. Titles, prices and suppliers are shared by all shops.
      </p>
      <Async state={st}>
        {(list) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((s) => {
              const isCurrent = currentShop?.id === s.id;
              return (
                <div key={s.id} className={`p-3.5 border-2 border-black flex flex-col justify-between bg-white ${isCurrent ? 'shadow-[4px_4px_0px_0px_#15803D] ring-2 ring-[#15803D]' : 'shadow-[2px_2px_0px_0px_#1A1A1A]'} ${s.active ? '' : 'opacity-60'}`}>
                  <div>
                    <div className="flex items-start justify-between gap-1 mb-1.5">
                      <strong className="font-serif font-black text-base text-black leading-snug">{s.name}</strong>
                      <span className="font-mono text-xs font-bold px-1.5 py-0.5 border border-black bg-[#FAF9F5] flex-shrink-0">{s.code}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      {s.isHq && <span className="text-[.68rem] font-mono font-bold uppercase tracking-wider bg-[#1A1A1A] text-[#CCFF00] px-2 py-0.5 border border-black">HQ</span>}
                      {s.city && <span className="text-[.68rem] font-mono font-bold bg-[#EEF2FF] text-[#4F46E5] px-2 py-0.5 border border-[#4F46E5]">{s.city}</span>}
                      {s.active ? <Badge kind="ok">active</Badge> : <Badge kind="bad">closed</Badge>}
                    </div>
                    <div className="text-xs text-[#374151] space-y-1 mb-3">
                      <div className="flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 text-black flex-shrink-0 mt-0.5" /><span className="line-clamp-2">{s.address || 'No address yet'}</span></div>
                      {s.phone && <div className="flex items-center gap-1.5 font-mono text-[.75rem]"><Phone className="w-3.5 h-3.5 text-black flex-shrink-0" /><span>{s.phone}</span></div>}
                    </div>
                  </div>
                  <div className="pt-2.5 border-t border-[#E5E7EB] flex flex-wrap items-center gap-1.5">
                    {isCurrent
                      ? <span className="flex items-center gap-1 text-xs font-mono font-bold text-[#15803D] bg-[#DCFCE7] px-2 py-1 border border-[#15803D]"><CheckCircle2 className="w-3.5 h-3.5" /> Working here</span>
                      : s.active && <button type="button" className="btn btn-sm font-mono text-xs font-bold" onClick={() => { selectShop(s.id); toast(`Switched to ${s.name}`); }}>Switch →</button>}
                    <button type="button" className="btn btn-sm" onClick={() => setDlg(s)}>Edit</button>
                    {!s.isHq && s.active && <button type="button" className="btn btn-sm" onClick={() => update(s, { isHq: true }, `${s.name} is now the head office`)}>Make HQ</button>}
                    {!s.isHq && <button type="button" className="btn btn-sm" onClick={() => update(s, { active: !s.active }, s.active ? `${s.name} closed` : `${s.name} reopened`)}>{s.active ? 'Close' : 'Reopen'}</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Async>
      {dlg && <ShopDialog shop={dlg === 'add' ? null : dlg} onClose={() => setDlg(null)} onDone={reload} />}
    </section>
  );
}

function ShopPicker({ shops, value, onChange }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {shops.filter((s) => s.active).map((s) => (
        <label key={s.id} className="!normal-case !font-normal !tracking-normal !text-[.9rem] !text-ink flex items-center gap-1.5 border border-black px-2 py-1">
          <input type="checkbox" checked={value.includes(s.id)} onChange={() => toggle(s.id)} /> {s.name} <span className="font-mono text-xs text-muted">{s.code}</span>
        </label>
      ))}
    </div>
  );
}

function UserDialog({ mode, user, shops, onClose, onDone, isSelf }) {
  const [f, setF] = useState({
    username: user?.username || '', fullName: user?.fullName || '', password: '', role: user?.role || 'staff',
    shopIds: user?.shopIds?.length ? user.shopIds : (shops.length === 1 ? [shops[0].id] : []),
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [go, busy] = useAction(async () => {
    if (mode === 'reset') {
      await post(`/users/${user.id}/password`, { newPassword: f.password }); toast('Password reset');
    } else if (mode === 'edit') {
      await put(`/users/${user.id}`, { username: f.username, role: f.role, fullName: f.fullName, ...(f.role === 'owner' ? {} : { shopIds: f.shopIds }) }); toast('User updated');
    } else {
      await post('/users', { ...f, shopIds: f.role === 'owner' ? undefined : f.shopIds }); toast('User created');
    }
    onDone?.(); onClose();
  });
  const title = mode === 'reset' ? `Reset password: ${user.username}` : mode === 'edit' ? `Edit user: ${user.username}` : 'Add user';
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={go}>
        {mode !== 'reset' && <div className="grid grid-cols-2 gap-x-2.5">
          <Field label="Username" htmlFor="un"><input id="un" className="input" maxLength={50} autoComplete="off" value={f.username} onChange={set('username')} /></Field>
          <Field label="Full name" htmlFor="fn"><input id="fn" className="input" maxLength={100} value={f.fullName} onChange={set('fullName')} /></Field>
        </div>}
        {mode !== 'edit' && <Field label="Password (8+ characters)" htmlFor="pwd"><input id="pwd" type="password" className="input" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>}
        {mode !== 'reset' && <>
          <Field label="Role" htmlFor="rl">
            <select id="rl" className="input" value={f.role} onChange={set('role')} disabled={isSelf}>
              <option value="staff">Staff</option><option value="manager">Manager</option><option value="owner">Owner</option>
            </select>
          </Field>
          <p className="text-muted text-[.85rem] -mt-1 mb-2">{ROLE_HELP[f.role]}</p>
          {f.role !== 'owner' && <>
            <div className="text-xs font-mono font-bold uppercase mb-1">Works in</div>
            <ShopPicker shops={shops} value={f.shopIds} onChange={(shopIds) => setF((x) => ({ ...x, shopIds }))} />
          </>}
        </>}
        {mode === 'reset' && <p className="text-muted text-[.85rem]">The user will be signed out everywhere.</p>}
        <Actions><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{mode === 'reset' ? 'Reset' : mode === 'edit' ? 'Save' : 'Create user'}</Button></Actions>
      </form>
    </Modal>
  );
}

function UsersCard() {
  const { user: me } = useAuth();
  const st = useCached(['admin', 'users'], () => get('/users'));
  const shopsSt = useCached(['admin', 'shops'], () => get('/shops'));
  const [dlg, setDlg] = useState(null); // { mode, user }
  const shops = shopsSt.data || [];
  const shopName = (id) => shops.find((s) => s.id === id)?.code || `#${id}`;
  return (
    <section className="card mt-3.5">
      <div className="flex justify-between items-center mb-1.5"><h2 className="!mb-0">People</h2><button className="btn" onClick={() => setDlg({ mode: 'add' })}>+ Add user</button></div>
      <Async state={st}>
        {(us) => (
          <div className="table-wrap"><table className="ledger">
            <thead><tr><th>User</th><th>Role</th><th>Shops</th><th>Status</th><th /></tr></thead>
            <tbody>{us.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.fullName}</strong><div className="text-muted text-[.8rem] font-mono">{u.username}</div></td>
                <td>{u.role}</td>
                <td className="font-mono text-[.85rem]">{u.role === 'owner' ? 'all' : u.shopIds.map(shopName).join(', ')}</td>
                <td>{u.active ? <Badge kind="ok">active</Badge> : <Badge kind="bad">disabled</Badge>}</td>
                <td className="whitespace-nowrap">
                  <button className="btn btn-sm" onClick={() => setDlg({ mode: 'edit', user: u })}>Edit</button>{' '}
                  <button className="btn btn-sm" onClick={() => setDlg({ mode: 'reset', user: u })}>Reset password</button>{' '}
                  {u.id !== me.id && <Button small variant={u.active ? 'danger' : ''} onClick={async () => { await post(`/users/${u.id}/active`, { active: !u.active }); st.reload(); }}>{u.active ? 'Disable' : 'Enable'}</Button>}
                </td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Async>
      {dlg && <UserDialog {...dlg} isSelf={dlg.user?.id === me.id} shops={shops} onClose={() => setDlg(null)} onDone={st.reload} />}
    </section>
  );
}

export default function Settings() {
  const { isOwner } = useAuth();
  return (
    <div>
      <PageTitle
        actions={<span className="bg-[#F1F5F9] text-[#475569] font-mono text-xs font-bold px-2.5 py-1 border border-[#475569] shadow-[2px_2px_0px_0px_#475569]">System Config</span>}
      >
        Settings
      </PageTitle>
      {isOwner && <div className="grid lg:grid-cols-2 gap-3 items-start"><PasswordCard /><BusinessRulesCard /></div>}
      {!isOwner && <p className="text-muted">Contact an owner to change or reset your password.</p>}
      {isOwner && <ShopsCard />}
      {isOwner && <UsersCard />}
    </div>
  );
}
