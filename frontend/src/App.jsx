import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, Link } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useAction } from './lib/ui';
import { useFranchise } from './lib/franchise';
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
import RegisterBusiness from './pages/RegisterBusiness';

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

const GROUPS = [
  { name: 'Sales', tag: 'bg-[#DCFCE7] text-[#15803D]' },
  { name: 'Stock', tag: 'bg-[#EEF2FF] text-[#4F46E5]' },
  { name: 'Reports', tag: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  { name: 'Admin', tag: 'bg-[#F1F5F9] text-[#475569]' },
  { name: 'Documentation', tag: 'bg-[#FEFCE8] text-[#854D0E]' },
];

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
  const { currentFranchise, franchises, selectFranchise } = useFranchise();
  const { pathname } = useLocation();
  const [signOut] = useAction(logout);
  const current = pages.find((p) => p.path === pathname);
  const sectionId = getSectionId(pathname);

  useEffect(() => {
    document.title = `${current ? current.title + ' · ' : ''}${settings.shopName}`;
  }, [current, settings.shopName]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr] md:grid-rows-[auto_1fr] print:block bg-[#FAF9F5]">
      <aside className="bg-white border-r-2 border-black md:row-span-2 md:sticky md:top-0 md:h-screen overflow-y-auto flex flex-col print:hidden shadow-sm">
        <NavLink
          to="/"
          className="block px-3.5 py-3 border-b-2 border-black bg-white no-underline hover:bg-[#FAF9F5] transition-colors"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-[#1A1A1A] text-[#CCFF00] font-mono font-bold px-1.5 py-0.5 text-[10px] border border-black shadow-[1.5px_1.5px_0px_0px_#1A1A1A]">
              BK-OS
            </span>
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#4F46E5]">
              Multi-Franchise
            </span>
          </div>
          <div className="font-serif font-black text-[1.12rem] text-black leading-tight truncate">
            {settings.shopName}
          </div>
          <div className="text-[10px] font-mono font-bold text-[#15803D] mt-1 flex items-center gap-1 truncate bg-[#DCFCE7] px-1.5 py-0.5 border border-[#15803D]">
            <span>🏢</span>
            <span className="truncate">{currentFranchise.name}</span>
          </div>
        </NavLink>

        <nav aria-label="Main" className="flex md:flex-col flex-wrap md:flex-nowrap p-1.5 gap-0.5">
          {GROUPS.map(({ name: g, tag }) => {
            const items = pages.filter((p) => p.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="contents md:block mb-2">
                <div className="hidden md:flex items-center justify-between text-[.68rem] tracking-[.1em] uppercase font-mono font-bold px-2.5 pt-2 pb-1 text-[#4B5563]">
                  <span>{g}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${tag.split(' ')[0]}`}></span>
                </div>
                {items.map((p) => (
                  <NavLink
                    key={p.path}
                    to={p.path}
                    className={({ isActive }) =>
                      `block px-2.5 py-1.5 text-xs no-underline transition-all my-0.5 ${
                        isActive
                          ? 'bg-[#1A1A1A] text-[#CCFF00] font-mono font-bold border-l-4 border-[#CCFF00] shadow-[2px_2px_0px_0px_#1A1A1A]'
                          : 'text-black border-l-[3px] border-transparent hover:bg-[#1A1A1A] hover:text-[#CCFF00] font-sans font-medium'
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

      <header className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white/95 backdrop-blur-md border-b-2 border-black sticky top-0 z-20 print:hidden shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-serif font-black text-lg text-black tracking-tight">{current?.title}</span>
          {sectionId && (
            <Link
              to={`/help?section=${sectionId}`}
              className="px-2.5 py-1 bg-[#EEF2FF] text-[#4F46E5] border border-[#4F46E5] font-mono font-bold text-xs hover:bg-[#4F46E5] hover:text-white transition-all shadow-[2px_2px_0px_0px_#4F46E5] flex items-center gap-1"
              title={`View ${current?.title} documentation in Help Manual`}
            >
              <span className="font-bold">?</span> Help for this page
            </Link>
          )}

          {/* Franchise Selector Badge */}
          <div className="hidden lg:flex items-center gap-1.5 bg-[#FAF9F5] border-2 border-black px-2 py-0.5 shadow-[2px_2px_0px_0px_#1A1A1A]">
            <span className="text-xs" title="Franchise Storefront">🏢</span>
            <select
              aria-label="Active Franchise Store"
              value={currentFranchise.id}
              onChange={(e) => selectFranchise(e.target.value)}
              className="bg-transparent text-xs font-mono font-bold text-black outline-none cursor-pointer border-none p-0 pr-1"
            >
              {franchises.map((f) => (
                <option key={f.id} value={f.id} className="bg-white text-black font-sans">
                  {f.name} ({f.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/help"
            className="text-xs font-mono font-bold text-[#4F46E5] hover:underline hidden sm:inline-block"
          >
            📖 Manual
          </Link>
          <Link
            to="/landing"
            className="text-xs font-mono font-bold text-black hover:bg-[#CCFF00] px-2 py-0.5 border border-black shadow-[1px_1px_0px_0px_#1A1A1A] hidden md:inline-block"
          >
            Platform Info
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-[#4B5563] text-xs font-medium whitespace-nowrap">
              <strong className="text-black font-semibold">{user.fullName}</strong>
              <span className={`inline-block px-1.5 py-0.2 ml-1 text-[10px] font-mono font-bold uppercase border ${
                user.role === 'owner' ? 'bg-[#1A1A1A] text-[#CCFF00] border-black' : 'bg-[#FEF3C7] text-[#B45309] border-[#B45309]'
              }`}>
                {user.role}
              </span>
            </span>
            <button
              className="btn btn-sm border-2 border-black bg-white hover:bg-[#BE123C] hover:text-white hover:border-[#BE123C] ml-1"
              onClick={signOut}
              title="Sign out of Bookshop Terminal"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 md:p-5 min-w-0 max-w-[1440px] w-full outline-none print:p-0">
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

  if (!ready) return <div className="p-10 text-center text-muted font-mono">Loading…</div>;

  if (!user) {
    if (pathname === '/help') {
      return <Help publicView />;
    }
    if (pathname === '/login') {
      return <Login />;
    }
    if (pathname === '/register' || pathname === '/register-business') {
      return <RegisterBusiness />;
    }
    return <Landing />;
  }

  // Staff never get owner routes at all (the server enforces this too).
  return <Shell pages={PAGES.filter((p) => !p.owner || isOwner)} />;
}
