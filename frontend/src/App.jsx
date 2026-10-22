import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useAction } from './lib/ui';
import { EASE } from './lib/motion';
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
  const dateLine = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr] md:grid-rows-[auto_1fr] print:block">
      <aside className="bg-sheet/60 border-r border-line md:row-span-2 md:sticky md:top-0 md:h-screen overflow-y-auto flex flex-col print:hidden">
        <NavLink to="/" className="block px-5 pt-6 pb-5 border-b border-line no-underline">
          <span className="block font-serif italic text-[1.55rem] leading-[1.1] text-ink">{settings.shopName}</span>
          <span className="block mt-1.5 text-[.62rem] uppercase tracking-[.22em] text-muted">Bookshop ledger</span>
        </NavLink>
        <nav aria-label="Main" className="flex md:flex-col flex-wrap md:flex-nowrap py-2">
          {GROUPS.map((g) => {
            const items = pages.filter((p) => p.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="contents md:block md:mt-3">
                <div className="hidden md:block text-[.62rem] font-semibold tracking-[.2em] uppercase text-muted px-5 pb-1">{g}</div>
                {items.map((p) => (
                  <NavLink key={p.path} to={p.path}
                    className={({ isActive }) => `block px-5 py-1.5 no-underline border-l-2 transition-colors duration-300 ${isActive ? 'border-terracotta text-ink font-medium bg-tint/60' : 'border-transparent text-muted hover:text-ink'}`}>
                    {p.title}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <header className="flex items-center justify-between gap-3 px-8 py-3 border-b border-line md:sticky md:top-0 z-20 bg-paper/95 print:hidden">
        <span className="text-[.68rem] uppercase tracking-[.18em] text-muted">{dateLine}</span>
        <span className="text-muted whitespace-nowrap text-[.9rem]">{user.fullName} <span className="text-[.7rem] uppercase tracking-wider">({user.role})</span> · <button className="btn btn-link" onClick={signOut}>Sign out</button></span>
      </header>
      <main className="px-5 md:px-10 py-7 min-w-0 max-w-[1400px] w-full outline-none print:p-0">
        <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
          <Routes>
            {pages.map((p) => <Route key={p.path} path={p.path} element={p.el} />)}
            <Route path="/receipt/:id" element={<Receipt />} />
            <Route path="*" element={<Navigate to={isOwner ? '/dashboard' : '/billing'} replace />} />
          </Routes>
        </motion.div>
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
