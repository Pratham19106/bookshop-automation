import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useAction } from './lib/ui';
import Login from './pages/Login';
import Billing from './pages/Billing';
import Bills from './pages/Bills';
import Orders from './pages/Orders';
import Catalogue from './pages/Catalogue';
import Inventory from './pages/Inventory';
import Restock from './pages/Restock';
import Suppliers from './pages/Suppliers';
import Purchases from './pages/Purchases';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Settings from './pages/Settings';
import Receipt from './pages/Receipt';

// path -> sidebar group, title, component, owner-only flag
const PAGES = [
  { path: '/billing', group: 'Sales', title: 'Billing', el: <Billing /> },
  { path: '/bills', group: 'Sales', title: 'Bills', el: <Bills /> },
  { path: '/orders', group: 'Sales', title: 'Phone Orders', el: <Orders /> },
  { path: '/catalogue', group: 'Stock', title: 'Catalogue', el: <Catalogue /> },
  { path: '/inventory', group: 'Stock', title: 'Inventory', el: <Inventory /> },
  { path: '/restock', group: 'Stock', title: 'Restocking', el: <Restock />, owner: true },
  { path: '/suppliers', group: 'Stock', title: 'Suppliers', el: <Suppliers />, owner: true },
  { path: '/purchases', group: 'Stock', title: 'Purchases', el: <Purchases />, owner: true },
  { path: '/dashboard', group: 'Reports', title: 'Dashboard', el: <Dashboard />, owner: true },
  { path: '/expenses', group: 'Reports', title: 'Expenses', el: <Expenses />, owner: true },
  { path: '/settings', group: 'Admin', title: 'Settings', el: <Settings /> },
];
const GROUPS = ['Sales', 'Stock', 'Reports', 'Admin'];

function Shell({ pages }) {
  const { user, settings, logout, isOwner } = useAuth();
  const { pathname } = useLocation();
  const [signOut] = useAction(logout);
  const current = pages.find((p) => p.path === pathname);
  useEffect(() => { document.title = `${current ? current.title + ' · ' : ''}${settings.shopName}`; }, [current, settings.shopName]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[200px_1fr] md:grid-rows-[auto_1fr] print:block">
      <aside className="bg-sheet border-r border-ink md:row-span-2 md:sticky md:top-0 md:h-screen overflow-y-auto flex flex-col print:hidden">
        <NavLink to="/" className="block px-3 py-3 border-b border-ink font-serif font-bold text-[1.05rem] text-ink no-underline">{settings.shopName}</NavLink>
        <nav aria-label="Main" className="flex md:flex-col flex-wrap md:flex-nowrap">
          {GROUPS.map((g) => {
            const items = pages.filter((p) => p.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="contents md:block md:border-t md:border-hair first:md:border-t-0">
                <div className="hidden md:block text-[.7rem] tracking-[.1em] uppercase text-muted px-3 pt-2.5 pb-0.5">{g}</div>
                {items.map((p) => (
                  <NavLink key={p.path} to={p.path}
                    className={({ isActive }) => `block px-3 py-1 text-ink no-underline border-l-[3px] hover:bg-ink hover:text-paper ${isActive ? 'bg-tint border-ink font-bold' : 'border-transparent'}`}>
                    {p.title}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <header className="flex items-center justify-between gap-3 px-3.5 py-1.5 bg-sheet border-b border-ink md:sticky md:top-0 z-20 print:hidden">
        <span className="font-serif font-bold">{current?.title}</span>
        <span className="text-muted whitespace-nowrap">{user.fullName} ({user.role}) · <button className="btn btn-link" onClick={signOut}>Sign out</button></span>
      </header>
      <main className="p-3.5 min-w-0 max-w-[1400px] w-full outline-none print:p-0">
        <Routes>
          {pages.map((p) => <Route key={p.path} path={p.path} element={p.el} />)}
          <Route path="/receipt/:id" element={<Receipt />} />
          <Route path="*" element={<Navigate to={isOwner ? '/dashboard' : '/billing'} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, ready, isOwner } = useAuth();
  if (!ready) return <div className="p-10 text-center text-muted">Loading…</div>;
  if (!user) return <Login />;
  // Staff never get owner routes at all (the server enforces this too).
  return <Shell pages={PAGES.filter((p) => !p.owner || isOwner)} />;
}
