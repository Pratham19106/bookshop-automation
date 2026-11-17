import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, Link } from 'react-router-dom';
import { atLeast, useAuth } from './lib/auth';
import { useAction } from './lib/ui';
import { useShop } from './lib/shop';
import { useLiveStatus } from './lib/realtime';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Billing from './pages/Billing';
import Bills from './pages/Bills';
import Orders from './pages/Orders';
import Catalogue from './pages/Catalogue';
import Inventory from './pages/Inventory';
import Restock from './pages/Restock';
import Suppliers from './pages/Suppliers';
import Purchases from './pages/Purchases';
import Dashboard from './pages/Dashboard';
import SalesReport from './pages/SalesReport';
import Statement from './pages/Statement';
import Expenses from './pages/Expenses';
import Settings from './pages/Settings';
import Receipt from './pages/Receipt';
import AdjustmentReceipt from './pages/AdjustmentReceipt';
import Help from './pages/Help';
import Shelves from './pages/ShopLayout';
import Arrangement from './pages/Arrangement';
import RegisterBusiness from './pages/RegisterBusiness';
import {
  ShoppingCart,
  Receipt as ReceiptIcon,
  PhoneCall,
  BookMarked,
  Layers,
  Grid,
  RefreshCw,
  Truck,
  PackageCheck,
  LayoutDashboard,
  ReceiptText,
  Settings as SettingsIcon,
  HelpCircle,
  Building2,
  FileText,
  BookOpen,
  Menu,
  X,
} from 'lucide-react';


// path -> sidebar group, title, component, minimum role (staff when absent), icon
const PAGES = [
  { path: '/billing', group: 'Sales', title: 'Billing', el: <Billing />, icon: ShoppingCart },
  { path: '/bills', group: 'Sales', title: 'Bills', el: <Bills />, icon: ReceiptIcon },
  { path: '/orders', group: 'Sales', title: 'Phone Orders', el: <Orders />, icon: PhoneCall },
  { path: '/catalogue', group: 'Stock', title: 'Catalogue', el: <Catalogue />, icon: BookMarked },
  { path: '/inventory', group: 'Stock', title: 'Inventory', el: <Inventory />, icon: Layers },
  { path: '/shelves', group: 'Stock', title: 'Floor & Shelves', el: <Shelves />, icon: Grid },
  { path: '/arrangement', group: 'Stock', title: 'Books to Arrange', el: <Arrangement />, icon: Layers },
  { path: '/restock', group: 'Stock', title: 'Restocking', min: 'manager', el: <Restock />, icon: RefreshCw },
  { path: '/suppliers', group: 'Stock', title: 'Suppliers', min: 'manager', el: <Suppliers />, icon: Truck },
  { path: '/purchases', group: 'Stock', title: 'Purchases', min: 'manager', el: <Purchases />, icon: PackageCheck },
  { path: '/dashboard', group: 'Reports', title: 'Dashboard', min: 'manager', el: <Dashboard />, icon: LayoutDashboard },
  { path: '/statement', group: 'Reports', title: 'Financial Statement', min: 'manager', el: <Statement />, icon: FileText },
  { path: '/sales-report', group: 'Reports', title: 'Sales Report', min: 'manager', el: <SalesReport />, icon: ReceiptText },
  { path: '/expenses', group: 'Reports', title: 'Expenses', min: 'manager', el: <Expenses />, icon: ReceiptText },
  { path: '/settings', group: 'Admin', title: 'Settings', el: <Settings />, icon: SettingsIcon },
  { path: '/help', group: 'Documentation', title: 'Help & Manual', el: <Help />, icon: HelpCircle },
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
  if (['billing', 'bills', 'orders', 'catalogue', 'inventory', 'shelves', 'restock', 'suppliers', 'purchases', 'dashboard', 'statement', 'expenses', 'settings'].includes(seg)) {
    return seg;
  }
  return null;
}

function Shell({ pages }) {
  const { user, settings, logout, isManager } = useAuth();
  const { currentShop, shops, selectShop } = useShop();
  const { pathname } = useLocation();
  const [signOut] = useAction(logout);
  const live = useLiveStatus();
  const current = pages.find((p) => p.path === pathname);
  const sectionId = getSectionId(pathname);

  useEffect(() => {
    document.title = `${current ? current.title + ' · ' : ''}${settings.shopName}`;
  }, [current, settings.shopName]);

  // Phones and small tablets: the sidebar is a slide-in menu. It closes on navigation, backdrop tap or Escape.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // keep the page behind the menu still
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [menuOpen]);

  const shopSwitcher = shops.length > 1 && (
    <div className="flex items-center gap-2 bg-[#FAF9F5] border-2 border-black px-2.5 py-1 shadow-[2px_2px_0px_0px_#1A1A1A] min-w-0">
      <Building2 className="w-4 h-4 text-black flex-shrink-0" title="Active shop" />
      <select
        aria-label="Active shop"
        value={currentShop?.id ?? ''}
        onChange={(e) => { selectShop(e.target.value); setMenuOpen(false); }}
        className="bg-transparent text-sm sm:text-xs font-mono font-bold text-black outline-none cursor-pointer border-none p-0 pr-1 min-w-0 max-w-full"
      >
        {shops.map((f) => (
          <option key={f.id} value={f.id} className="bg-white text-black font-sans">
            {f.name} ({f.code})
          </option>
        ))}
      </select>
    </div>
  );
  const roleBadge = (
    <span className={`inline-block px-2 py-0.5 text-xs font-mono font-bold uppercase border ${
      user.role === 'owner' ? 'bg-[#1A1A1A] text-[#CCFF00] border-black' : user.role === 'manager' ? 'bg-[#EEF2FF] text-[#4F46E5] border-[#4F46E5]' : 'bg-[#FEF3C7] text-[#B45309] border-[#B45309]'
    }`}>
      {user.role}
    </span>
  );

  return (
    <div className="min-h-screen print:block bg-[#FAF9F5] text-base">
      {/* At every screen size the menu is a pop-out drawer: hidden by default so pages get the full width
          (phones, split screen, desktop), opened from the menu button, closed after navigating. */}
      {menuOpen && <div className="fixed inset-0 z-40 bg-black/50 print:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <aside
        id="main-menu"
        className={`bg-white border-r-2 border-black overflow-y-auto flex flex-col print:hidden shadow-hard-lg
          fixed inset-y-0 left-0 z-50 w-[82vw] max-w-[300px] transition-[transform,visibility] duration-200 ease-out
          ${menuOpen ? 'translate-x-0' : '-translate-x-full invisible'}`}
        aria-label="Menu"
        aria-hidden={!menuOpen}
      >
        <div className="flex items-start border-b-2 border-black">
          <NavLink
            to="/"
            onClick={() => setMenuOpen(false)}
            className="block flex-1 min-w-0 px-4 py-3.5 bg-white no-underline hover:bg-[#FAF9F5] transition-colors"
          >
            <div className="font-serif font-black text-xl text-black leading-tight truncate">
              {settings.businessName || settings.shopName}
            </div>
            <div className="text-xs font-mono font-bold text-[#15803D] mt-1.5 flex items-center gap-1.5 truncate bg-[#DCFCE7] px-2 py-0.5 border border-[#15803D]">
              <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{currentShop ? currentShop.name : 'No shop assigned'}</span>
            </div>
          </NavLink>
          <button className="m-2 w-9 h-9 flex items-center justify-center border-2 border-black bg-white" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Phone only: who is signed in, shop switcher, sign out (the header has no room for them) */}
        <div className="sm:hidden px-3 py-3 border-b-2 border-black space-y-2.5">
          <div className="flex items-center gap-2 text-sm"><strong className="truncate">{user.fullName}</strong>{roleBadge}</div>
          {shopSwitcher}
          <button className="btn btn-sm w-full" onClick={signOut}>Sign out</button>
        </div>

        {/* Any tap on a menu link closes the menu, including the page you are already on (no route change then). */}
        <nav aria-label="Main" className="flex flex-col p-2 gap-1" onClick={(e) => { if (e.target.closest('a')) setMenuOpen(false); }}>
          {GROUPS.map(({ name: g, tag }) => {
            const items = pages.filter((p) => p.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="block mb-3">
                <div className="flex items-center justify-between text-xs tracking-[.1em] uppercase font-mono font-bold px-3 pt-2.5 pb-1 text-[#4B5563]">
                  <span>{g}</span>
                  <span className={`w-2 h-2 rounded-full ${tag.split(' ')[0]}`}></span>
                </div>
                {items.map((p) => {
                  const Icon = p.icon;
                  return (
                    <NavLink
                      key={p.path}
                      to={p.path}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2.5 md:py-2 text-base md:text-sm no-underline transition-all my-0.5 ${
                          isActive
                            ? 'bg-[#1A1A1A] text-[#CCFF00] font-mono font-bold border-l-4 border-[#CCFF00] shadow-[2px_2px_0px_0px_#1A1A1A]'
                            : 'text-black border-l-[3px] border-transparent hover:bg-[#1A1A1A] hover:text-[#CCFF00] font-sans font-medium'
                        }`
                      }
                    >
                      {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                      <span>{p.title}</span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      <header className="flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-5 py-2.5 sm:py-3 bg-white/95 backdrop-blur-md border-b-2 border-black sticky top-0 z-20 print:hidden shadow-sm min-w-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center border-2 border-black bg-white shadow-[2px_2px_0px_0px_#1A1A1A] hover:bg-[#CCFF00]"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-controls="main-menu"
            aria-expanded={menuOpen}
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-serif font-black text-lg sm:text-xl text-black tracking-tight truncate">{current?.title}</span>
          {sectionId && (
            <Link
              to={`/help?section=${sectionId}`}
              className="hidden sm:flex px-3 py-1 bg-[#EEF2FF] text-[#4F46E5] border border-[#4F46E5] font-mono font-bold text-xs hover:bg-[#4F46E5] hover:text-white transition-all shadow-[2px_2px_0px_0px_#4F46E5] items-center gap-1.5"
              title={`View ${current?.title} documentation in Help Manual`}
            >
              <HelpCircle className="w-3.5 h-3.5" /> Help
            </Link>
          )}

          {/* Shop switcher: only when the user works in more than one shop (in the menu on phones) */}
          {shopSwitcher && <div className="hidden sm:block">{shopSwitcher}</div>}
        </div>

        <div className="flex items-center gap-2 sm:gap-3.5 flex-shrink-0">
          {live === 'reconnecting' && (
            <span className="text-xs text-[#B45309]" role="status" title="Lost the live connection; retrying. Figures may be a few seconds old.">Reconnecting…</span>
          )}
          <Link
            to="/help"
            className="text-xs font-mono font-bold text-[#4F46E5] hover:underline hidden lg:flex items-center gap-1"
          >
            <BookOpen className="w-3.5 h-3.5" /> Manual
          </Link>
          <div className="flex items-center gap-2.5">
            <span className="text-[#4B5563] text-sm font-medium whitespace-nowrap flex items-center gap-1.5">
              <strong className="text-black font-semibold hidden md:inline">{user.fullName}</strong>
              {roleBadge}
            </span>
            <button
              className="hidden sm:inline-flex btn btn-sm border-2 border-black bg-white hover:bg-[#BE123C] hover:text-white hover:border-[#BE123C] ml-1"
              onClick={signOut}
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main key={currentShop?.id ?? 'none'} className="p-3 sm:p-5 md:p-6 min-w-0 max-w-[1440px] w-full mx-auto outline-none print:p-0">
        <Routes>
          {pages.map((p) => (
            <Route key={p.path} path={p.path} element={p.el} />
          ))}
          <Route path="/receipt/:id" element={<Receipt />} />
          <Route path="/adjustment/:id" element={<AdjustmentReceipt />} />
          <Route path="*" element={<Navigate to={isManager ? '/dashboard' : '/billing'} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  const { pathname } = useLocation();

  if (!ready) return <div className="p-10 text-center text-muted font-mono text-base">Loading…</div>;

  if (pathname === '/landing' || (!user && pathname === '/')) return <Landing />;

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
    return <Navigate to="/login" replace />;
  }

  // Pages above the user's role are not routed at all (the server enforces the same rules).
  return <Shell pages={PAGES.filter((p) => !p.min || atLeast(user.role, p.min))} />;
}
