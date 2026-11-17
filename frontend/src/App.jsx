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
  Info,
  Building2,
  BookOpen,
} from 'lucide-react';


// path -> sidebar group, title, component, owner-only flag, icon
const PAGES = [
  { path: '/billing', group: 'Sales', title: 'Billing', el: <Billing />, icon: ShoppingCart },
  { path: '/bills', group: 'Sales', title: 'Bills', el: <Bills />, icon: ReceiptIcon },
  { path: '/orders', group: 'Sales', title: 'Phone Orders', el: <Orders />, icon: PhoneCall },
  { path: '/catalogue', group: 'Stock', title: 'Catalogue', el: <Catalogue />, icon: BookMarked },
  { path: '/inventory', group: 'Stock', title: 'Inventory', el: <Inventory />, icon: Layers },
  { path: '/shelves', group: 'Stock', title: 'Floor & Shelves', el: <Shelves />, icon: Grid },
  { path: '/restock', group: 'Stock', title: 'Restocking', el: <Restock />, owner: true, icon: RefreshCw },
  { path: '/suppliers', group: 'Stock', title: 'Suppliers', el: <Suppliers />, owner: true, icon: Truck },
  { path: '/purchases', group: 'Stock', title: 'Purchases', el: <Purchases />, owner: true, icon: PackageCheck },
  { path: '/dashboard', group: 'Reports', title: 'Dashboard', el: <Dashboard />, owner: true, icon: LayoutDashboard },
  { path: '/expenses', group: 'Reports', title: 'Expenses', el: <Expenses />, owner: true, icon: ReceiptText },
  { path: '/settings', group: 'Admin', title: 'Settings', el: <Settings />, icon: SettingsIcon },
  { path: '/help', group: 'Documentation', title: 'Help & Manual', el: <Help />, icon: HelpCircle },
  { path: '/landing', group: 'Documentation', title: 'Platform Info', el: <Landing />, icon: Info },
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
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr] md:grid-rows-[auto_1fr] print:block bg-[#FAF9F5] text-base">
      <aside className="bg-white border-r-2 border-black md:row-span-2 md:sticky md:top-0 md:h-screen overflow-y-auto flex flex-col print:hidden shadow-sm">
        <NavLink
          to="/"
          className="block px-4 py-3.5 border-b-2 border-black bg-white no-underline hover:bg-[#FAF9F5] transition-colors"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-5 h-5 bg-[#1A1A1A] text-[#CCFF00] border border-black flex items-center justify-center shadow-[1.5px_1.5px_0px_0px_#1A1A1A]">
              <BookOpen className="w-3 h-3" />
            </span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#4F46E5]">
              Multi-Store
            </span>
          </div>
          <div className="font-serif font-black text-xl text-black leading-tight truncate">
            {settings.shopName}
          </div>
          <div className="text-xs font-mono font-bold text-[#15803D] mt-1.5 flex items-center gap-1.5 truncate bg-[#DCFCE7] px-2 py-0.5 border border-[#15803D]">
            <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{currentFranchise.name}</span>
          </div>
        </NavLink>

        <nav aria-label="Main" className="flex md:flex-col flex-wrap md:flex-nowrap p-2 gap-1">
          {GROUPS.map(({ name: g, tag }) => {
            const items = pages.filter((p) => p.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="contents md:block mb-3">
                <div className="hidden md:flex items-center justify-between text-xs tracking-[.1em] uppercase font-mono font-bold px-3 pt-2.5 pb-1 text-[#4B5563]">
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
                        `flex items-center gap-2.5 px-3 py-2 text-sm no-underline transition-all my-0.5 ${
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

      <header className="flex items-center justify-between gap-3 px-5 py-3 bg-white/95 backdrop-blur-md border-b-2 border-black sticky top-0 z-20 print:hidden shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-serif font-black text-xl text-black tracking-tight">{current?.title}</span>
          {sectionId && (
            <Link
              to={`/help?section=${sectionId}`}
              className="px-3 py-1 bg-[#EEF2FF] text-[#4F46E5] border border-[#4F46E5] font-mono font-bold text-xs hover:bg-[#4F46E5] hover:text-white transition-all shadow-[2px_2px_0px_0px_#4F46E5] flex items-center gap-1.5"
              title={`View ${current?.title} documentation in Help Manual`}
            >
              <HelpCircle className="w-3.5 h-3.5" /> Help
            </Link>
          )}

          {/* Franchise Selector Badge */}
          <div className="hidden lg:flex items-center gap-2 bg-[#FAF9F5] border-2 border-black px-2.5 py-1 shadow-[2px_2px_0px_0px_#1A1A1A]">
            <Building2 className="w-4 h-4 text-black flex-shrink-0" title="Franchise Storefront" />
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

        <div className="flex items-center gap-3.5">
          <Link
            to="/help"
            className="text-xs font-mono font-bold text-[#4F46E5] hover:underline hidden sm:flex items-center gap-1"
          >
            <BookOpen className="w-3.5 h-3.5" /> Manual
          </Link>
          <Link
            to="/landing"
            className="text-xs font-mono font-bold text-black hover:bg-[#CCFF00] px-2.5 py-1 border border-black shadow-[1px_1px_0px_0px_#1A1A1A] hidden md:inline-block"
          >
            Platform Info
          </Link>
          <div className="flex items-center gap-2.5">
            <span className="text-[#4B5563] text-sm font-medium whitespace-nowrap">
              <strong className="text-black font-semibold">{user.fullName}</strong>
              <span className={`inline-block px-2 py-0.5 ml-1.5 text-xs font-mono font-bold uppercase border ${
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

      <main className="p-5 md:p-6 min-w-0 max-w-[1440px] w-full outline-none print:p-0">
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

  if (!ready) return <div className="p-10 text-center text-muted font-mono text-base">Loading…</div>;

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
