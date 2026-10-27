import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAction, Field } from '../lib/ui';

export default function Landing() {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  // Sign-in state for the embedded quick sign-in card
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const [submit, busy] = useAction(async (e) => {
    e?.preventDefault?.();
    setErr('');
    try {
      await login(u, p);
    } catch (e) {
      setErr(e.message);
    }
  });

  const fillDemo = (username, password) => {
    setU(username);
    setP(password);
  };

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const MODULES = [
    {
      id: 'billing',
      num: '01',
      title: 'Counter POS & Billing',
      category: 'sales',
      color: 'bg-emerald-50 text-emerald-950 border-emerald-600',
      badgeColor: 'bg-emerald-500 text-white',
      shadowColor: 'neo-shadow-emerald',
      tag: 'Atomic Checkout',
      summary: 'Barcode scanning, instant ISBN matching, role-capped discounts, and BEGIN IMMEDIATE atomic database commits.',
      path: '/help?section=billing'
    },
    {
      id: 'catalogue',
      num: '02',
      title: 'Catalogue & Shelf Coordinates',
      category: 'stock',
      color: 'bg-indigo-50 text-indigo-950 border-indigo-600',
      badgeColor: 'bg-indigo-600 text-white',
      shadowColor: 'neo-shadow-indigo',
      tag: 'ISBN-10 & 13 Checksum',
      summary: 'Mathematical check-digit verification prevents catalog typos. Exact physical Aisle, Rack, and Shelf coordinates.',
      path: '/help?section=catalogue'
    },
    {
      id: 'orders',
      num: '03',
      title: 'Phone Orders & Lock Reservations',
      category: 'sales',
      color: 'bg-amber-50 text-amber-950 border-amber-600',
      badgeColor: 'bg-amber-500 text-black font-bold',
      shadowColor: 'neo-shadow-amber',
      tag: 'Zero Double-Selling',
      summary: 'Phone-in reservations lock physical copies in real-time. Counter sales cannot oversell reserved customer orders.',
      path: '/help?section=orders'
    },
    {
      id: 'inventory',
      num: '04',
      title: 'Inventory & Movement Ledger',
      category: 'stock',
      color: 'bg-cyan-50 text-cyan-950 border-cyan-600',
      badgeColor: 'bg-cyan-600 text-white',
      shadowColor: 'neo-shadow-cyan',
      tag: 'Append-Only Ledger',
      summary: 'SQLite CHECK constraints enforce stock >= 0. Every single sale, delivery, and audit correction is permanently logged.',
      path: '/help?section=inventory'
    },
    {
      id: 'restock',
      num: '05',
      title: 'Rule-Based Restocking Engine',
      category: 'intelligence',
      color: 'bg-purple-50 text-purple-950 border-purple-600',
      badgeColor: 'bg-purple-600 text-white',
      shadowColor: 'neo-shadow-purple',
      tag: 'Velocity & Lead Time',
      summary: 'Calculates observed sales velocity across active trading days, evaluates cover days, and routes to cheapest supplier.',
      path: '/help?section=restock'
    },
    {
      id: 'purchases',
      num: '06',
      title: 'Purchases & Goods Receipts',
      category: 'stock',
      color: 'bg-rose-50 text-rose-950 border-rose-600',
      badgeColor: 'bg-rose-500 text-white',
      shadowColor: 'neo-shadow-rose',
      tag: 'Weighted-Average Cost',
      summary: 'Purchase order lifecycle with partial shipment check-ins, over-receipt protection, and automatic inventory unit cost updates.',
      path: '/help?section=purchases'
    },
    {
      id: 'dashboard',
      num: '07',
      title: 'Financial P&L Dashboard',
      category: 'intelligence',
      color: 'bg-blue-50 text-blue-950 border-blue-600',
      badgeColor: 'bg-blue-600 text-white',
      shadowColor: 'neo-shadow-black',
      tag: 'True COGS Snapshot',
      summary: 'Real Net Revenue, Cost of Goods Sold recorded at sale timestamp, Gross Profit, Operating Expenses, and Local Day Bucketing.',
      path: '/help?section=dashboard'
    }
  ];

  const filteredModules = activeCategory === 'all'
    ? MODULES
    : MODULES.filter((m) => m.category === activeCategory);

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-ink font-sans selection:bg-[#CCFF00] selection:text-black overflow-x-hidden">
      


      {/* Main Navbar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b-2 border-black shadow-sm">
        <div className="max-w-[1340px] mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="bg-[#1A1A1A] text-[#CCFF00] font-mono font-bold px-2 py-0.5 text-xs border border-black shadow-[2px_2px_0px_0px_#1A1A1A]">
              BK-OS
            </span>
            <span className="font-serif font-black text-xl text-ink tracking-tight flex items-center gap-1.5">
              Bookshop Automation System
            </span>
          </div>

          {/* Navigation Shortcuts */}
          <div className="flex items-center flex-wrap gap-1 text-[.82rem] font-bold">
            <button onClick={() => scrollTo('overview')} className="px-2.5 py-1 text-ink hover:bg-black hover:text-white transition-colors">Overview</button>
            <button onClick={() => scrollTo('features')} className="px-2.5 py-1 text-ink hover:bg-black hover:text-white transition-colors">7 Modules</button>
            <button onClick={() => scrollTo('interactive')} className="px-2.5 py-1 text-ink hover:bg-black hover:text-white transition-colors">Terminal</button>
            <button onClick={() => scrollTo('workflows')} className="px-2.5 py-1 text-ink hover:bg-black hover:text-white transition-colors">Workflows</button>
            <button onClick={() => scrollTo('roles')} className="px-2.5 py-1 text-ink hover:bg-black hover:text-white transition-colors">Permissions</button>
            <Link to="/help" className="px-3 py-1 bg-[#EEF2FF] text-[#4F46E5] border border-[#4F46E5] font-bold hover:bg-[#4F46E5] hover:text-white transition-all ml-1">
              📖 Help Manual →
            </Link>
            {user ? (
              <Link to="/dashboard" className="px-3 py-1 bg-[#1A1A1A] text-[#CCFF00] border-2 border-black font-mono font-bold hover:bg-[#CCFF00] hover:text-black transition-all ml-2 shadow-[2px_2px_0px_0px_#1A1A1A]">
                Launch App ({user.username}) →
              </Link>
            ) : (
              <button onClick={() => scrollTo('signin')} className="px-3 py-1 bg-[#CCFF00] text-black border-2 border-black font-mono font-bold hover:bg-black hover:text-[#CCFF00] transition-all ml-2 shadow-[2px_2px_0px_0px_#1A1A1A]">
                Sign In ↓
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section: Electric High-Contrast Split Grid */}
      <section className="relative border-b-2 border-black bg-gradient-to-br from-[#FEFCE8] via-[#FAF9F5] to-[#EFF6FF] py-12 md:py-16 px-4">
        <div className="max-w-[1340px] mx-auto grid lg:grid-cols-[1.25fr_0.75fr] gap-10 items-center">
          
          {/* Left Hero: Punchy Typography & Verified Guarantees */}
          <div className="animate-slide-up">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="bg-[#CCFF00] text-black font-mono text-xs font-black uppercase px-2.5 py-1 border-2 border-black shadow-[3px_3px_0px_0px_#1A1A1A] rotate-[-1deg]">
                ⚡ High-Precision Retail OS
              </span>

              <span className="bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold uppercase px-2.5 py-1 border border-[#15803D] flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#16A34A] animate-ping"></span> Live & Verified
              </span>
            </div>

            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-black leading-[1.08] mb-5 text-[#1A1A1A] tracking-tight border-0 pb-0">
              The Architecture of a <span className="bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] bg-clip-text text-transparent underline decoration-[#CCFF00] decoration-wavy decoration-2">Flawless Bookshop.</span>
            </h1>

            <p className="text-lg md:text-xl text-[#4B5563] leading-relaxed mb-6 max-w-2xl font-normal">
              Purpose-engineered for physical independent bookshops. 
              Eliminate phantom inventory, prevent accidental double-selling of phone orders, 
              compare competing supplier quotes instantly, and ring up atomic counter sales with 
              <strong className="text-black font-semibold"> zero negative stock</strong>.
            </p>

            {/* Vibrant Feature Pills Grid */}


            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => scrollTo('features')} className="px-5 py-3 bg-[#1A1A1A] text-[#CCFF00] font-mono font-bold text-sm border-2 border-black shadow-[4px_4px_0px_0px_#4F46E5] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#4F46E5] transition-all">
                EXPLORE ALL 7 MODULES ↓
              </button>
              <Link to="/help" className="px-5 py-3 bg-white text-black font-mono font-bold text-sm border-2 border-black shadow-[4px_4px_0px_0px_#1A1A1A] hover:bg-[#FAF5FF] hover:text-[#7C3AED] transition-all">
                READ COMPLETE MANUAL →
              </Link>
            </div>
          </div>

          {/* Right Hero: Modern Neo-Brutalist Sign-in Register */}
          <div id="signin" className="animate-stamp">
            <div className="bg-white border-2 border-black p-6 shadow-[8px_8px_0px_0px_#1A1A1A] relative">
              
              {/* Badge Decorator */}
              <div className="absolute -top-3.5 -right-3.5 bg-[#CCFF00] text-black font-mono font-black text-[.7rem] px-2.5 py-1 border-2 border-black shadow-[2px_2px_0px_0px_#1A1A1A] uppercase rotate-2">
                Till Ready ⚡
              </div>

              <div className="flex items-center justify-between pb-3 mb-4 border-b-2 border-black">
                <div>
                  <div className="text-[.7rem] uppercase tracking-wider font-mono font-bold text-[#4F46E5]">
                    Point-of-Sale Access
                  </div>
                  <h2 className="!mb-0 text-2xl font-serif font-black text-black">Sign in to Terminal</h2>
                </div>
                <span className="inline-block px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] font-mono text-[.72rem] font-bold border border-[#15803D]">
                  API Online
                </span>
              </div>

              {user ? (
                <div className="py-4 text-center">
                  <div className="p-3 bg-[#EEF2FF] border-2 border-[#4338CA] text-[#312E81] mb-4 font-medium text-sm">
                    Authenticated session active for <strong>{user.fullName}</strong> ({user.role})
                  </div>
                  <Link
                    to={user.role === 'owner' ? '/dashboard' : '/billing'}
                    className="block w-full py-3 bg-[#1A1A1A] text-[#CCFF00] font-mono font-bold text-center border-2 border-black shadow-[4px_4px_0px_0px_#4F46E5] hover:bg-[#CCFF00] hover:text-black transition-all"
                  >
                    Open Workspace ({user.role === 'owner' ? 'Dashboard' : 'Billing'}) →
                  </Link>
                </div>
              ) : (
                <div>
                  {/* One-click demo credentials */}
                  <div className="mb-4 p-2.5 bg-[#FEF9C3] border-2 border-black text-[.8rem]">
                    <div className="text-[.68rem] uppercase font-mono font-bold text-black mb-1.5 flex items-center justify-between">
                      <span>Quick Demo Credentials:</span>
                      <span className="text-muted font-normal">Click to fill</span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        className="flex-1 py-1.5 px-2 bg-white hover:bg-black hover:text-[#CCFF00] text-black border-2 border-black font-mono font-bold text-xs transition-colors shadow-[2px_2px_0px_0px_#1A1A1A]"
                        onClick={() => fillDemo('Pratham19106', 'Password123')}
                      >
                        ⚡ Fill Owner (Pratham19106)
                      </button>
                      <button
                        type="button"
                        className="flex-1 py-1.5 px-2 bg-white hover:bg-black hover:text-[#38BDF8] text-black border-2 border-black font-mono font-bold text-xs transition-colors shadow-[2px_2px_0px_0px_#1A1A1A]"
                        onClick={() => fillDemo('worker', 'Worker123')}
                      >
                        🔑 Fill Worker (worker)
                      </button>
                    </div>
                  </div>

                  <form className="space-y-3.5" onSubmit={submit}>
                    <Field label="Operator Username" htmlFor="u">
                      <input
                        id="u"
                        className="input border-2 border-black focus:border-[#4F46E5] focus:ring-0 text-sm py-2 px-2.5 font-mono"
                        value={u}
                        onChange={(e) => setU(e.target.value)}
                        placeholder="owner or staff"
                        autoComplete="username"
                        required
                      />
                    </Field>

                    <Field label="Secret Password" htmlFor="p">
                      <input
                        id="p"
                        type="password"
                        className="input border-2 border-black focus:border-[#4F46E5] focus:ring-0 text-sm py-2 px-2.5 font-mono"
                        value={p}
                        onChange={(e) => setP(e.target.value)}
                        placeholder="••••••••••••"
                        autoComplete="current-password"
                        required
                      />
                    </Field>

                    {err && (
                      <div className="p-2 bg-[#FEE2E2] border-2 border-[#B91C1C] text-[#7F1D1D] font-mono text-xs font-bold">
                        {err}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full py-3 bg-[#1A1A1A] hover:bg-[#CCFF00] hover:text-black text-[#CCFF00] font-mono font-bold text-sm uppercase tracking-wider border-2 border-black shadow-[4px_4px_0px_0px_#4F46E5] hover:shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-x-[2px] hover:translate-y-[2px] transition-all cursor-pointer"
                      disabled={busy}
                    >
                      {busy ? 'Authenticating System…' : 'Enter Store Register (Enter)'}
                    </button>

 
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Rolling Banner 2: Moving in Reverse with Accent Color */}
      <div className="bg-[#CCFF00] text-black py-2.5 border-b-2 border-black overflow-hidden relative">
        <div className="marquee-track flex text-[.82rem] font-mono tracking-wider uppercase font-black">
          <div className="marquee-content-reverse flex items-center gap-6 pr-6">
            <span>⚡ PHYSICAL LOCATION MAPPING (AISLE/RACK/SHELF)</span>
            <span className="text-black/30">★</span>
            <span>RESTOCKING VELOCITY INTELLIGENCE</span>
            <span className="text-black/30">★</span>
            <span>CHEAPEST SUPPLIER QUOTES AUTOMATICALLY RANKED</span>
            <span className="text-black/30">★</span>
            <span>TELEPHONE RESERVATION EXPIRY GUARDS</span>
            <span className="text-black/30">★</span>
            <span>IMMUTABLE STOCK MOVEMENTS AUDIT TRAIL</span>
            <span className="text-black/30">★</span>
            <span>P&L WITH TRUE HISTORICAL COGS SNAPSHOT</span>
            <span className="text-black/30">★</span>
          </div>
          <div className="marquee-content-reverse flex items-center gap-6 pr-6" aria-hidden="true">
            <span>⚡ PHYSICAL LOCATION MAPPING (AISLE/RACK/SHELF)</span>
            <span className="text-black/30">★</span>
            <span>RESTOCKING VELOCITY INTELLIGENCE</span>
            <span className="text-black/30">★</span>
            <span>CHEAPEST SUPPLIER QUOTES AUTOMATICALLY RANKED</span>
            <span className="text-black/30">★</span>
            <span>TELEPHONE RESERVATION EXPIRY GUARDS</span>
            <span className="text-black/30">★</span>
            <span>IMMUTABLE STOCK MOVEMENTS AUDIT TRAIL</span>
            <span className="text-black/30">★</span>
            <span>P&L WITH TRUE HISTORICAL COGS SNAPSHOT</span>
            <span className="text-black/30">★</span>
          </div>
        </div>
      </div>

      {/* Section 1: Overview & 3 Architectural Pillars */}
      <section id="overview" className="max-w-[1340px] mx-auto py-16 px-4 border-b-2 border-black">
        <div className="mb-10 text-center max-w-3xl mx-auto">
          <span className="bg-[#EDE9FE] text-[#6D28D9] font-mono text-xs font-bold uppercase px-3 py-1 border border-[#6D28D9] mb-3 inline-block">
            Architectural Manifesto
          </span>
          <h2 className="text-3xl md:text-4xl font-serif font-black text-black mb-3">
            Built for Physical Books, Not Virtual Pixels.
          </h2>
          <p className="text-base md:text-lg text-[#4B5563]">
            SaaS platforms treat products as abstract line items. A real bookshop deals in physical editions, 
            warehouse aisles, phone reserves, and wholesale distributor margins.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="p-6 bg-white border-2 border-black shadow-[6px_6px_0px_0px_#4F46E5] relative">
            <div className="w-10 h-10 bg-[#EEF2FF] text-[#4F46E5] font-mono font-black text-lg border-2 border-black flex items-center justify-center mb-4">
              01
            </div>
            <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">Aisle, Rack & Shelf Indexing</h3>
            <p className="text-[.9rem] text-[#4B5563] leading-relaxed">
              Every edition in your catalogue is tagged with its real physical coordinates (e.g. <code>Aisle 2, Rack B, Shelf 4</code>). 
              Counter staff locate books for customers in seconds instead of hunting blindly.
            </p>
          </div>

          <div className="p-6 bg-white border-2 border-black shadow-[6px_6px_0px_0px_#059669] relative">
            <div className="w-10 h-10 bg-[#ECFDF5] text-[#059669] font-mono font-black text-lg border-2 border-black flex items-center justify-center mb-4">
              02
            </div>
            <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">Immediate Atomic Checkout</h3>
            <p className="text-[.9rem] text-[#4B5563] leading-relaxed">
              Counter sales run in a single transaction. If power cuts or stock validation fails, 
              the bill, line items, and stock deductions roll back atomically without ghost invoices.
            </p>
          </div>

          <div className="p-6 bg-white border-2 border-black shadow-[6px_6px_0px_0px_#D97706] relative">
            <div className="w-10 h-10 bg-[#FFFBEB] text-[#D97706] font-mono font-black text-lg border-2 border-black flex items-center justify-center mb-4">
              03
            </div>
            <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">Reserved Stock Protection</h3>
            <p className="text-[.9rem] text-[#4B5563] leading-relaxed">
              When a customer calls to reserve a book, stock is placed into <code>reserved</code> status immediately. 
              The counter POS will refuse to sell that copy to a walk-in, eliminating humiliating customer apologies.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: The 7 Core Modules Horizontal Showcase & Filter */}
      <section id="features" className="max-w-[1340px] mx-auto py-16 px-4 border-b-2 border-black">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <span className="bg-[#CFFAFE] text-[#0E7490] font-mono text-xs font-bold uppercase px-3 py-1 border border-[#0E7490] mb-2 inline-block">
              Interactive System Map
            </span>
            <h2 className="text-3xl md:text-4xl font-serif font-black text-black !mb-0">
              The 7 Core Platform Modules
            </h2>
          </div>

          {/* Category Filter Buttons */}
          <div className="flex flex-wrap gap-1.5 font-mono text-xs font-bold">
            {['all', 'sales', 'stock', 'intelligence'].map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 uppercase border-2 border-black transition-all ${
                  activeCategory === cat
                    ? 'bg-black text-[#CCFF00] shadow-[2px_2px_0px_0px_#4F46E5]'
                    : 'bg-white text-black hover:bg-[#FAF5FF]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Horizontal Scroll Track / Carousel */}
        <div className="flex overflow-x-auto gap-5 pb-6 pt-2 snap-x scrollbar-thin scrollbar-thumb-black">
          {filteredModules.map((m) => (
            <div
              key={m.id}
              className={`min-w-[320px] md:min-w-[360px] max-w-[380px] flex-shrink-0 p-5 bg-white border-2 border-black ${m.shadowColor} snap-start flex flex-col justify-between hover:-translate-y-1 transition-transform`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={`font-mono text-xs font-black px-2 py-0.5 border border-black ${m.badgeColor}`}>
                    MODULE {m.num}
                  </span>
                  <span className="font-mono text-xs font-bold text-muted bg-[#F3F4F6] px-2 py-0.5 border border-hair">
                    {m.stat}
                  </span>
                </div>

                <div className="text-[.72rem] uppercase font-mono font-bold text-navy mb-1">{m.tag}</div>
                <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">{m.title}</h3>
                <p className="text-[.88rem] text-[#4B5563] leading-relaxed mb-4">{m.summary}</p>
              </div>

              <div className="pt-3 border-t-2 border-black flex items-center justify-between">
                <Link
                  to={m.path}
                  className="font-mono text-xs font-black text-black hover:text-[#4F46E5] flex items-center gap-1 group"
                >
                  Inspect Rules & Guide <span className="group-hover:translate-x-1 transition-transform">→</span>
                </Link>
                <span className="w-2.5 h-2.5 bg-black"></span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between text-xs font-mono text-muted">
          <span>← Swipe or scroll horizontally to explore all modules</span>
          <Link to="/help" className="text-black font-bold underline hover:text-[#4F46E5]">
            Open Full Functional Index in Help Manual →
          </Link>
        </div>
      </section>



      {/* Section 4: Daily Operating Workflows */}
      <section id="workflows" className="max-w-[1340px] mx-auto py-16 px-4 border-b-2 border-black">
        <div className="mb-10 text-center max-w-3xl mx-auto">
          <span className="bg-[#FEF3C7] text-[#B45309] font-mono text-xs font-bold uppercase px-3 py-1 border border-[#B45309] mb-3 inline-block">
            Standard Operating Procedures
          </span>
          <h2 className="text-3xl md:text-4xl font-serif font-black text-black mb-3">
            A Day in the Life with the System
          </h2>
          <p className="text-base text-[#4B5563]">
            Follow standardized, bulletproof daily routines designed for maximum counter speed and inventory precision.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="p-5 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#4F46E5] flex flex-col justify-between">
            <div>
              <div className="w-8 h-8 bg-[#4F46E5] text-white font-mono font-black flex items-center justify-center mb-3">
                1
              </div>
              <h3 className="!mt-0 !mb-2 text-lg font-serif font-bold text-black">Morning Review</h3>
              <p className="text-[.85rem] text-[#4B5563] leading-relaxed mb-3">
                Open Restocking to check Critical alert titles. Review computed sales velocity and dispatch POs to the cheapest quoted vendor with 1 click.
              </p>
            </div>
            <div className="pt-2 border-t border-hair font-mono text-[.75rem] text-navy font-bold">
              Route: #/restock
            </div>
          </div>

          <div className="p-5 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#059669] flex flex-col justify-between">
            <div>
              <div className="w-8 h-8 bg-[#059669] text-white font-mono font-black flex items-center justify-center mb-3">
                2
              </div>
              <h3 className="!mt-0 !mb-2 text-lg font-serif font-bold text-black">Counter Checkout</h3>
              <p className="text-[.85rem] text-[#4B5563] leading-relaxed mb-3">
                Scan barcode or type ISBN. Staff discount caps prevent unauthorized loss. Finalize bill on Enter and hand customer thermal slip.
              </p>
            </div>
            <div className="pt-2 border-t border-hair font-mono text-[.75rem] text-olive font-bold">
              Route: #/billing
            </div>
          </div>

          <div className="p-5 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#D97706] flex flex-col justify-between">
            <div>
              <div className="w-8 h-8 bg-[#D97706] text-white font-mono font-black flex items-center justify-center mb-3">
                3
              </div>
              <h3 className="!mt-0 !mb-2 text-lg font-serif font-bold text-black">Receive Deliveries</h3>
              <p className="text-[.85rem] text-[#4B5563] leading-relaxed mb-3">
                Check-in distributor boxes in Purchases. Partial deliveries accepted; inventory unit cost dynamically recalibrates for true P&L.
              </p>
            </div>
            <div className="pt-2 border-t border-hair font-mono text-[.75rem] text-ochre font-bold">
              Route: #/purchases
            </div>
          </div>

          <div className="p-5 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#BE123C] flex flex-col justify-between">
            <div>
              <div className="w-8 h-8 bg-[#BE123C] text-white font-mono font-black flex items-center justify-center mb-3">
                4
              </div>
              <h3 className="!mt-0 !mb-2 text-lg font-serif font-bold text-black">Nightly Hot Backup</h3>
              <p className="text-[.85rem] text-[#4B5563] leading-relaxed mb-3">
                Review Dashboard for Net Sales and Gross Profit. Log daily overheads in Expenses. Run automated online backup command.
              </p>
            </div>
            <div className="pt-2 border-t border-hair font-mono text-[.75rem] text-brick font-bold">
              Route: #/dashboard
            </div>
          </div>
        </div>
      </section>

      {/* Section 5: Permissions & Role Matrix */}
      <section id="roles" className="max-w-[1340px] mx-auto py-16 px-4 border-b-2 border-black">
        <div className="mb-8">
          <span className="bg-[#EDE9FE] text-[#6D28D9] font-mono text-xs font-bold uppercase px-3 py-1 border border-[#6D28D9] mb-2 inline-block">
            Security Enforcement
          </span>
          <h2 className="text-3xl md:text-4xl font-serif font-black text-black">Owner vs Staff Permission Boundaries</h2>
          <p className="text-base text-[#4B5563] max-w-2xl">
            Access rules are enforced by backend express route middleware and session cookies, not cosmetic CSS toggles.
          </p>
        </div>

        <div className="table-wrap border-2 border-black shadow-[6px_6px_0px_0px_#1A1A1A]">
          <table className="ledger">
            <thead>
              <tr className="bg-[#F8FAFC]">
                <th className="py-2.5 px-3">System Action</th>
                <th className="w-[140px] py-2.5 px-3">Staff Role</th>
                <th className="w-[140px] py-2.5 px-3">Owner Role</th>
                <th className="py-2.5 px-3">Enforcement Safeguard</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-2.5 px-3"><strong>Counter Billing & Sales</strong></td>
                <td><span className="px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Active</span></td>
                <td><span className="px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Active</span></td>
                <td className="text-muted text-xs">Staff discount is capped by shop setting. Higher discounts refused by server.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3"><strong>Void Invoices</strong></td>
                <td><span className="px-2 py-0.5 bg-[#FEE2E2] text-[#B91C1C] font-mono text-xs font-bold border border-[#B91C1C]">Refused (403)</span></td>
                <td><span className="px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Authorized</span></td>
                <td className="text-muted text-xs">Voiding restores physical inventory and removes transaction from sales reports.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3"><strong>Wholesale Supplier Cost Data</strong></td>
                <td><span className="px-2 py-0.5 bg-[#FEE2E2] text-[#B91C1C] font-mono text-xs font-bold border border-[#B91C1C]">Hidden (403)</span></td>
                <td><span className="px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Full Access</span></td>
                <td className="text-muted text-xs">Supplier wholesale prices and margin data are stripped from staff catalogue responses.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3"><strong>Physical Stock Audit Adjustments</strong></td>
                <td><span className="px-2 py-0.5 bg-[#FEE2E2] text-[#B91C1C] font-mono text-xs font-bold border border-[#B91C1C]">Refused (403)</span></td>
                <td><span className="px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Authorized</span></td>
                <td className="text-muted text-xs">Requires counted quantity and mandatory audit reason written to movement log.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3"><strong>Financial P&L Dashboard</strong></td>
                <td><span className="px-2 py-0.5 bg-[#FEE2E2] text-[#B91C1C] font-mono text-xs font-bold border border-[#B91C1C]">Refused (403)</span></td>
                <td><span className="px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Full Analytics</span></td>
                <td className="text-muted text-xs">Cost of goods sold, gross margin, and operating profit reports are owner-only.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 6: Terminal & Production Reference */}

      {/* Footer: Modern High Contrast */}
      <footer className="bg-[#1A1A1A] text-white border-t-4 border-black py-12 px-4">
        <div className="max-w-[1340px] mx-auto flex flex-wrap justify-between items-center gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-3 h-3 bg-[#CCFF00]"></span>
              <span className="font-serif font-black text-xl text-white">Bookshop Automation System</span>
            </div>
            <div className="font-mono text-xs text-white/60">
              Single-Store Physical Retail Architecture 
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="px-3 py-1.5 bg-white/10 hover:bg-white hover:text-black text-white font-mono text-xs font-bold border border-white/30 transition-colors"
            >
              ↑ Top of Page
            </button>
            <Link
              to="/help"
              className="px-4 py-1.5 bg-[#CCFF00] text-black font-mono text-xs font-black uppercase tracking-wider border-2 border-black shadow-[3px_3px_0px_0px_#4F46E5] hover:bg-white transition-all"
            >
              Open System Help Guide →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
