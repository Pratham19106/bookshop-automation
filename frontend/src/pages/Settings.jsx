import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';
import { toast } from '../lib/overlays';
import { Actions, Async, Badge, Button, Field, Modal, PageTitle, useAction } from '../lib/ui';
import { useFranchise } from '../lib/franchise';
import { broadcastEvent, subscribeToActivity } from '../lib/supabase';
import { Building2, MapPin, Phone, CheckCircle2, Plus } from 'lucide-react';

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

function AddShopDialog({ onClose, onDone }) {
  const { refreshFranchises } = useFranchise();
  const [f, setF] = useState({
    name: '',
    code: '',
    city: 'Hyderabad',
    address: '',
    phone: '',
    email: '',
    isHeadquarters: false,
  });
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setF((x) => ({ ...x, [k]: val }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return toast('Shop name is required', 'bad');
    if (!f.city.trim()) return toast('City is required', 'bad');
    if (!f.address.trim()) return toast('Physical address is required', 'bad');

    setBusy(true);
    try {
      const created = await post('/franchises', {
        name: f.name.trim(),
        code: f.code.trim(),
        city: f.city.trim(),
        address: f.address.trim(),
        phone: f.phone.trim(),
        email: f.email.trim(),
        isHeadquarters: f.isHeadquarters,
      });

      broadcastEvent('franchise', { action: 'created', franchise: created });
      await refreshFranchises();
      toast(`Shop outlet "${created.name}" registered successfully`);
      onDone?.();
      onClose();
    } catch (err) {
      toast(err.message || 'Failed to create shop outlet', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Register New Shop Outlet" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Shop / Outlet Name *" htmlFor="sh_name">
            <input
              id="sh_name"
              className="input font-medium"
              placeholder="e.g. Srinivasa Book Store - Gachibowli"
              required
              maxLength={100}
              value={f.name}
              onChange={set('name')}
            />
          </Field>
          <Field label="Branch Code (optional)" htmlFor="sh_code">
            <input
              id="sh_code"
              className="input font-mono uppercase"
              placeholder="e.g. FR-003 (auto if empty)"
              maxLength={20}
              value={f.code}
              onChange={set('code')}
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="City *" htmlFor="sh_city">
            <input
              id="sh_city"
              className="input"
              placeholder="e.g. Hyderabad"
              required
              maxLength={50}
              value={f.city}
              onChange={set('city')}
            />
          </Field>
          <Field label="Contact Phone" htmlFor="sh_phone">
            <input
              id="sh_phone"
              className="input font-mono"
              placeholder="e.g. 040-2345 6789"
              maxLength={30}
              value={f.phone}
              onChange={set('phone')}
            />
          </Field>
        </div>

        <Field label="Physical Street Address *" htmlFor="sh_addr">
          <textarea
            id="sh_addr"
            rows={2}
            className="input resize-none"
            placeholder="Plot / Door No, Street, Landmark, Area, Pincode"
            required
            maxLength={300}
            value={f.address}
            onChange={set('address')}
          />
        </Field>

        <Field label="Outlet Contact Email (optional)" htmlFor="sh_email">
          <input
            id="sh_email"
            type="email"
            className="input"
            placeholder="e.g. branch@bookstore.com"
            maxLength={100}
            value={f.email}
            onChange={set('email')}
          />
        </Field>

        <label className="flex items-center gap-2.5 p-2.5 bg-[#FAF9F5] border border-black cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-4 h-4 accent-black cursor-pointer"
            checked={f.isHeadquarters}
            onChange={set('isHeadquarters')}
          />
          <span className="text-xs font-mono font-bold text-black">
            Designate as Central Headquarters (HQ) Outlet
          </span>
        </label>

        <Actions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Registering…' : 'Register Shop Outlet'}
          </button>
        </Actions>
      </form>
    </Modal>
  );
}

function FranchisesCard() {
  const { currentFranchise, selectFranchise, refreshFranchises } = useFranchise();
  const st = useLoad(() => get('/franchises'), []);
  const [dlg, setDlg] = useState(false);

  useEffect(() => {
    const unsub = subscribeToActivity((act) => {
      if (act?.event === 'franchise') {
        st.reload();
      }
    });
    return unsub;
  }, []);

  const shops = st.data || [];

  return (
    <section className="card mt-3.5">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-3 pb-2 border-b-2 border-black">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-black" />
          <h2 className="!mb-0">Storefronts &amp; Outlets</h2>
          <span className="badge badge-info font-mono font-bold">
            {shops.length} {shops.length === 1 ? 'Location' : 'Locations'}
          </span>
        </div>
        <button
          className="btn btn-primary shadow-[2px_2px_0px_0px_#1A1A1A] flex items-center gap-1.5"
          onClick={() => setDlg(true)}
        >
          <Plus className="w-4 h-4" /> Add New Shop
        </button>
      </div>

      <p className="text-muted text-xs font-mono mb-3">
        Each storefront maintains its physical branch address, contact lines, and real-time inventory ledger. Switch active counter terminal using the buttons below.
      </p>

      <Async state={st}>
        {(list) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((s) => {
              const isCurrent = currentFranchise?.id === s.id;
              const isHq = !!(s.is_headquarters || s.isHeadquarters);
              return (
                <div
                  key={s.id}
                  className={`p-3.5 border-2 border-black flex flex-col justify-between transition-all ${
                    isCurrent
                      ? 'bg-white shadow-[4px_4px_0px_0px_#15803D] ring-2 ring-[#15803D]'
                      : 'bg-white shadow-[2px_2px_0px_0px_#1A1A1A] hover:shadow-[4px_4px_0px_0px_#1A1A1A]'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-1 mb-1.5">
                      <strong className="font-serif font-black text-base text-black leading-snug">
                        {s.name}
                      </strong>
                      <span className="font-mono text-xs font-bold px-1.5 py-0.5 border border-black bg-[#FAF9F5] flex-shrink-0">
                        {s.code}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      {isHq && (
                        <span className="text-[.68rem] font-mono font-bold uppercase tracking-wider bg-[#1A1A1A] text-[#CCFF00] px-2 py-0.5 border border-black">
                          HQ Store
                        </span>
                      )}
                      <span className="text-[.68rem] font-mono font-bold bg-[#EEF2FF] text-[#4F46E5] px-2 py-0.5 border border-[#4F46E5]">
                        {s.city}
                      </span>
                      <span className="text-[.68rem] font-mono font-bold bg-[#DCFCE7] text-[#15803D] px-2 py-0.5 border border-[#15803D]">
                        Active
                      </span>
                    </div>

                    <div className="text-xs text-[#374151] space-y-1 mb-3">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-black flex-shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{s.address || 'Address not configured'}</span>
                      </div>
                      {s.phone && (
                        <div className="flex items-center gap-1.5 font-mono text-[.75rem]">
                          <Phone className="w-3.5 h-3.5 text-black flex-shrink-0" />
                          <span>{s.phone}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-[#E5E7EB] flex items-center justify-between">
                    {isCurrent ? (
                      <span className="flex items-center gap-1 text-xs font-mono font-bold text-[#15803D] bg-[#DCFCE7] px-2 py-1 border border-[#15803D]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Active Terminal
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm border-black hover:bg-[#CCFF00] hover:text-black font-mono text-xs font-bold"
                        onClick={() => {
                          selectFranchise(s.id);
                          toast(`Active POS switched to ${s.name}`);
                        }}
                      >
                        Switch Terminal →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Async>

      {dlg && (
        <AddShopDialog
          onClose={() => setDlg(false)}
          onDone={() => {
            st.reload();
            refreshFranchises();
          }}
        />
      )}
    </section>
  );
}

export default function Settings() {
  const { isOwner } = useAuth();
  return (
    <div>
      <PageTitle
        actions={
          <span className="bg-[#F1F5F9] text-[#475569] font-mono text-xs font-bold px-2.5 py-1 border border-[#475569] shadow-[2px_2px_0px_0px_#475569]">
            System Config
          </span>
        }
      >
        Settings
      </PageTitle>
      <div className="grid lg:grid-cols-2 gap-3 items-start"><PasswordCard />{isOwner && <ShopCard />}</div>
      {isOwner && <FranchisesCard />}
      {isOwner && <UsersCard />}
    </div>
  );
}
