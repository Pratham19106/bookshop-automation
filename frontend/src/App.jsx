import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, Link } from 'react-router-dom';
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
import Landing from './pages/Landing';
import Help from './pages/Help';
import Shelves from './pages/Shelves';

// path -> sidebar group, title, component, owner-only flag
const PAGES = [
  { path: '/billing', group: 'Sales', title: 'Billing', el: <Billing /> },
  { path: '/bills', group: 'Sales', title: 'Bills', el: <Bills /> },
  { path: '/orders', group: 'Sales', title: 'Phone Orders', el: <Orders /> },
  { path: '/catalogue', group: 'Stock', title: 'Catalogue', el: <Catalogue /> },
  { path: '/inventory', group: 'Stock', title: 'Inventory', el: <Inventory /> },
  { path: '/shelves', group: 'Stock', title: 'Floor & Shelves', el: <Shelves /> },
  { path: '/restock', group: 'Stock', title: 'Restocking', el: <Restock />, owner: true },
  { path: '/suppliers', group: 'Stock', title: 'Suppliers', el: <Suppliers />, owner: true },
  { path: '/purchases', group: 'Stock', title: 'Purchases', el: <Purchases />, owner: true },
  { path: '/dashboard', group: 'Reports', title: 'Dashboard', el: <Dashboard />, owner: true },
  { path: '/expenses', group: 'Reports', title: 'Expenses', el: <Expenses />, owner: true },
  { path: '/settings', group: 'Admin', title: 'Settings', el: <Settings /> },
  { path: '/help', group: 'Documentation', title: 'Help & Manual', el: <Help /> },
  { path: '/landing', group: 'Documentation', title: 'Platform Info', el: <Landing /> },
];
const GROUPS = ['Sales', 'Stock', 'Reports', 'Admin', 'Documentation'];

function getSectionId(pathname) {
  const seg = pathname.replace(/^\//, '').split('/')[0];
  if (seg === 'receipt') return 'billing';
  if (['billing', 'bills', 'orders', 'catalogue', 'inventory', 'shelves', 'restock', 'suppliers', 'purchases', 'dashboard', 'expenses', 'settings'].includes(seg)) {
    return seg;
  }
  return null;
}

function Shell({ pages }) {
  const { user, settings, logout, isOwner } = useAuth();
  const { pathname } = useLocation();
  const [signOut] = useAction(logout);
  const current = pages.find((p) => p.path === pathname);
  const sectionId = getSectionId(pathname);

  useEffect(() => {
    document.title = `${current ? current.title + ' · ' : ''}${settings.shopName}`;
  }, [current, settings.shopName]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[200px_1fr] md:grid-rows-[auto_1fr] print:block">
      <aside className="bg-sheet border-r border-ink md:row-span-2 md:sticky md:top-0 md:h-screen overflow-y-auto flex flex-col print:hidden">
        <NavLink to="/" className="block px-3 py-3 border-b border-ink font-serif font-bold text-[1.05rem] text-ink no-underline">
          {settings.shopName}
        </NavLink>
        <nav aria-label="Main" className="flex md:flex-col flex-wrap md:flex-nowrap">
          {GROUPS.map((g) => {
            const items = pages.filter((p) => p.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="contents md:block md:border-t md:border-hair first:md:border-t-0">
                <div className="hidden md:block text-[.7rem] tracking-[.1em] uppercase text-muted px-3 pt-2.5 pb-0.5">
                  {g}
                </div>
                {items.map((p) => (
                  <NavLink
                    key={p.path}
                    to={p.path}
                    className={({ isActive }) =>
                      `block px-3 py-1 text-ink no-underline border-l-[3px] hover:bg-ink hover:text-paper ${
                        isActive ? 'bg-tint border-ink font-bold' : 'border-transparent'
                      }`
                    }
                  >
                    {p.title}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <header className="flex items-center justify-between gap-3 px-3.5 py-1.5 bg-sheet border-b border-ink md:sticky md:top-0 z-20 print:hidden">
        <div className="flex items-center gap-2.5">
          <span className="font-serif font-bold text-base">{current?.title}</span>
          {sectionId && (
            <Link
              to={`/help?section=${sectionId}`}
              className="btn btn-sm text-[.78rem] bg-paper hover:bg-navy hover:text-white border-hair flex items-center gap-1 font-sans font-medium"
              title={`View ${current?.title} documentation in Help Manual`}
            >
              <span className="font-bold text-navy">?</span> Help for this page
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/help"
            className="text-[.8rem] text-navy hover:underline hidden sm:inline-block"
          >
            Help Manual
          </Link>
          <span className="text-muted text-[.82rem] whitespace-nowrap">
            {user.fullName} ({user.role}) ·{' '}
            <button className="btn btn-link" onClick={signOut}>
              Sign out
            </button>
          </span>
        </div>
      </header>

      <main className="p-3.5 min-w-0 max-w-[1400px] w-full outline-none print:p-0">
        <Routes>
          {pages.map((p) => (
            <Route key={p.path} path={p.path} element={p.el} />
          ))}
          <Route path="/receipt/:id" element={<Receipt />} />
          <Route path="*" element={<Navigate to={isOwner ? '/dashboard' : '/billing'} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, ready, isOwner } = useAuth();
  const { pathname } = useLocation();

  if (!ready) return <div className="p-10 text-center text-muted">Loading…</div>;

  if (!user) {
    if (pathname === '/help') {
      return <Help publicView />;
    }
    if (pathname === '/login') {
      return <Login />;
    }
    return <Landing />;
  }

  // Staff never get owner routes at all (the server enforces this too).
  return <Shell pages={PAGES.filter((p) => !p.owner || isOwner)} />;
}
