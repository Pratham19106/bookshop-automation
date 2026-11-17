import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { BookOpen, Building2, LogIn, HelpCircle, ArrowRight, Zap, Check, ChevronRight } from 'lucide-react';

export default function Landing() {
  const { user } = useAuth();
  const [activeCategory, setActiveCategory] = useState('all');

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
      summary: 'Database CHECK constraints enforce stock >= 0. Every single sale, delivery, and audit correction is permanently logged.',
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
    <div className="min-h-screen bg-[#FAF9F5] text-ink font-sans selection:bg-[#CCFF00] selection:text-black overflow-x-hidden text-base">
      
      {/* Main Navbar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b-2 border-black shadow-sm">
        <div className="max-w-[1340px] mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5 no-underline">
            <span className="w-9 h-9 bg-[#1A1A1A] text-[#CCFF00] border-2 border-black flex items-center justify-center shadow-[2px_2px_0px_0px_#1A1A1A]">
              <BookOpen className="w-5 h-5 text-[#CCFF00]" />
            </span>
            <span className="font-serif font-black text-2xl text-ink tracking-tight">
              Bookshop Automation System
            </span>
          </Link>

          {/* Navigation Shortcuts */}
          <div className="flex items-center flex-wrap gap-2.5 text-sm font-bold">
            <button onClick={() => scrollTo('overview')} className="px-3 py-1.5 text-ink hover:bg-black hover:text-white transition-colors">Overview</button>
            <button onClick={() => scrollTo('features')} className="px-3 py-1.5 text-ink hover:bg-black hover:text-white transition-colors">7 Modules</button>
            <button onClick={() => scrollTo('workflows')} className="px-3 py-1.5 text-ink hover:bg-black hover:text-white transition-colors">Workflows</button>
            <button onClick={() => scrollTo('roles')} className="px-3 py-1.5 text-ink hover:bg-black hover:text-white transition-colors">Permissions</button>
            <Link to="/help" className="px-3 py-1.5 bg-[#EEF2FF] text-[#4F46E5] border border-[#4F46E5] font-bold hover:bg-[#4F46E5] hover:text-white transition-all flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-[#4F46E5]" /> Help Manual
            </Link>
            {user ? (
              <Link to="/dashboard" className="px-4 py-1.5 bg-[#1A1A1A] text-[#CCFF00] border-2 border-black font-mono font-bold hover:bg-[#CCFF00] hover:text-black transition-all ml-1 shadow-[2px_2px_0px_0px_#1A1A1A]">
                Launch Terminal ({user.username}) →
              </Link>
            ) : (
              <div className="flex items-center gap-2 ml-1">
                <Link
                  to="/login"
                  className="px-3.5 py-1.5 bg-white hover:bg-black hover:text-white text-black border-2 border-black font-mono font-bold transition-all shadow-[2px_2px_0px_0px_#1A1A1A] text-sm"
                >
                  Log In
                </Link>
                <Link
                  to="/register"
                  className="px-4 py-1.5 bg-[#CCFF00] hover:bg-black hover:text-[#CCFF00] text-black border-2 border-black font-mono font-bold transition-all shadow-[2px_2px_0px_0px_#1A1A1A] text-sm"
                >
                  Sign Up →
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative border-b-2 border-black bg-gradient-to-br from-[#FEFCE8] via-[#FAF9F5] to-[#EFF6FF] py-14 md:py-20 px-4">
        <div className="max-w-[1340px] mx-auto grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
          
          {/* Left Hero */}
          <div className="animate-slide-up">
            <div className="mb-4">
              <span className="bg-[#EEF2FF] text-[#4F46E5] font-mono text-xs font-bold uppercase px-3 py-1 border border-[#4F46E5]">
                Retail POS & Multi-Store Chain Management
              </span>
            </div>

            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black leading-[1.12] mb-6 text-[#1A1A1A] tracking-tight border-0 pb-0">
              The Architecture of a <br className="hidden sm:inline" />
              <span className="text-[#4F46E5] underline decoration-[#CCFF00] decoration-[6px] underline-offset-8">
                Flawless Bookshop.
              </span>
            </h1>

            <p className="text-xl md:text-2xl text-[#4B5563] leading-relaxed mb-8 max-w-2xl font-normal">
              Purpose-engineered for physical independent bookshops and multi-outlet chains. 
              Eliminate phantom inventory, prevent accidental double-selling of phone orders, 
              compare competing supplier quotes instantly, and ring up atomic counter sales with 
              <strong className="text-black font-semibold"> zero negative stock</strong>.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-3.5">
              <Link
                to="/register"
                className="px-6 py-3.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white font-mono font-bold text-base border-2 border-black shadow-[4px_4px_0px_0px_#1A1A1A] hover:translate-x-[2px] hover:translate-y-[2px] transition-all flex items-center gap-2"
              >
                Sign Up / Register Business <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/login"
                className="px-6 py-3.5 bg-white hover:bg-black hover:text-[#CCFF00] text-black font-mono font-bold text-base border-2 border-black shadow-[4px_4px_0px_0px_#1A1A1A] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
              >
                Log In to Terminal →
              </Link>
              <button
                onClick={() => scrollTo('features')}
                className="px-5 py-3.5 bg-[#FAF9F5] text-black hover:bg-black hover:text-white font-mono font-bold text-base border-2 border-black transition-all"
              >
                Explore 7 Modules ↓
              </button>
            </div>
          </div>

          {/* Right Hero: Direct Sign-in or Register Portal Card */}
          <div className="animate-stamp">
            <div className="bg-white border-2 border-black p-6 sm:p-8 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="pb-4 mb-5 border-b-2 border-black">
                <div className="text-xs uppercase tracking-wider font-mono font-bold text-[#4F46E5] mb-1">
                  Terminal Access Portal
                </div>
                <h2 className="!mb-0 text-2xl sm:text-3xl font-serif font-black text-black">
                  Welcome to System
                </h2>
                <p className="text-sm sm:text-base text-[#4B5563] mt-1.5 font-normal">
                  Access your counter point-of-sale, oversee inventory, or onboard a new bookshop organization.
                </p>
              </div>

              {user ? (
                <div className="py-2 text-center space-y-4">
                  <div className="p-4 bg-[#EEF2FF] border-2 border-[#4338CA] text-[#312E81] text-base">
                    Authenticated session active for <strong>{user.fullName}</strong> ({user.role})
                    {user.business?.name && (
                      <div className="text-sm text-[#4F46E5] mt-1.5 font-mono font-bold flex items-center justify-center gap-1.5">
                        <Building2 className="w-4 h-4" /> {user.business.name}
                      </div>
                    )}
                  </div>
                  <Link
                    to={user.role === 'owner' ? '/dashboard' : '/billing'}
                    className="block w-full py-4 bg-[#1A1A1A] text-[#CCFF00] font-mono font-bold text-base text-center border-2 border-black shadow-[4px_4px_0px_0px_#4F46E5] hover:bg-[#CCFF00] hover:text-black transition-all"
                  >
                    Open Terminal Workspace ({user.role === 'owner' ? 'Dashboard' : 'POS Billing'}) →
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <Link
                      to="/login"
                      className="block w-full py-3.5 px-4 bg-[#1A1A1A] hover:bg-[#CCFF00] text-[#CCFF00] hover:text-black font-mono font-bold text-base text-center border-2 border-black shadow-[4px_4px_0px_0px_#4F46E5] hover:shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-x-[2px] hover:translate-y-[2px] transition-all flex items-center justify-center gap-2"
                    >
                      <LogIn className="w-5 h-5 text-[#CCFF00]" /> Log In to Existing Account →
                    </Link>

                    <Link
                      to="/register"
                      className="block w-full py-3.5 px-4 bg-[#FAF5FF] hover:bg-[#9333EA] text-[#6B21A8] hover:text-white font-mono font-bold text-base text-center border-2 border-black shadow-[4px_4px_0px_0px_#9333EA] hover:shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-x-[2px] hover:translate-y-[2px] transition-all flex items-center justify-center gap-2"
                    >
                      <Building2 className="w-5 h-5 text-[#6B21A8]" /> Sign Up / Register New Bookshop →
                    </Link>
                  </div>

                  <div className="pt-2 text-center">
                    <Link to="/help" className="text-sm font-mono font-bold text-[#4F46E5] hover:underline flex items-center justify-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-[#4F46E5]" /> View Help & System Manual →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Rolling Banner */}
      <div className="bg-[#CCFF00] text-black py-3 border-b-2 border-black overflow-hidden relative">
        <div className="marquee-track flex text-sm font-mono tracking-wider uppercase font-black">
          <div className="marquee-content-reverse flex items-center gap-6 pr-6">
            <span className="flex items-center gap-1.5"><Zap className="w-4 h-4" /> PHYSICAL LOCATION MAPPING (AISLE/RACK/SHELF)</span>
            <span className="text-black/40 font-bold">•</span>
            <span>RESTOCKING VELOCITY INTELLIGENCE</span>
            <span className="text-black/40 font-bold">•</span>
            <span>CHEAPEST SUPPLIER QUOTES AUTOMATICALLY RANKED</span>
            <span className="text-black/40 font-bold">•</span>
            <span>TELEPHONE RESERVATION EXPIRY GUARDS</span>
            <span className="text-black/40 font-bold">•</span>
            <span>IMMUTABLE STOCK MOVEMENTS AUDIT TRAIL</span>
            <span className="text-black/40 font-bold">•</span>
            <span>P&L WITH TRUE HISTORICAL COGS SNAPSHOT</span>
            <span className="text-black/40 font-bold">•</span>
          </div>
          <div className="marquee-content-reverse flex items-center gap-6 pr-6" aria-hidden="true">
            <span className="flex items-center gap-1.5"><Zap className="w-4 h-4" /> PHYSICAL LOCATION MAPPING (AISLE/RACK/SHELF)</span>
            <span className="text-black/40 font-bold">•</span>
            <span>RESTOCKING VELOCITY INTELLIGENCE</span>
            <span className="text-black/40 font-bold">•</span>
            <span>CHEAPEST SUPPLIER QUOTES AUTOMATICALLY RANKED</span>
            <span className="text-black/40 font-bold">•</span>
            <span>TELEPHONE RESERVATION EXPIRY GUARDS</span>
            <span className="text-black/40 font-bold">•</span>
            <span>IMMUTABLE STOCK MOVEMENTS AUDIT TRAIL</span>
            <span className="text-black/40 font-bold">•</span>
            <span>P&L WITH TRUE HISTORICAL COGS SNAPSHOT</span>
            <span className="text-black/40 font-bold">•</span>
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
          <p className="text-lg text-[#4B5563]">
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
            <p className="text-base text-[#4B5563] leading-relaxed">
              Every edition in your catalogue is tagged with its real physical coordinates (e.g. <code>Aisle 2, Rack B, Shelf 4</code>). 
              Counter staff locate books for customers in seconds instead of hunting blindly.
            </p>
          </div>

          <div className="p-6 bg-white border-2 border-black shadow-[6px_6px_0px_0px_#059669] relative">
            <div className="w-10 h-10 bg-[#ECFDF5] text-[#059669] font-mono font-black text-lg border-2 border-black flex items-center justify-center mb-4">
              02
            </div>
            <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">Immediate Atomic Checkout</h3>
            <p className="text-base text-[#4B5563] leading-relaxed">
              Counter sales run in a single transaction. If power cuts or stock validation fails, 
              the bill, line items, and stock deductions roll back atomically without ghost invoices.
            </p>
          </div>

          <div className="p-6 bg-white border-2 border-black shadow-[6px_6px_0px_0px_#D97706] relative">
            <div className="w-10 h-10 bg-[#FFFBEB] text-[#D97706] font-mono font-black text-lg border-2 border-black flex items-center justify-center mb-4">
              03
            </div>
            <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">Reserved Stock Protection</h3>
            <p className="text-base text-[#4B5563] leading-relaxed">
              When a customer calls to reserve a book, stock is placed into <code>reserved</code> status immediately. 
              The counter POS will refuse to sell that copy to a walk-in, eliminating customer apologies.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: The 7 Core Modules Showcase & Filter */}
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
          <div className="flex flex-wrap gap-2 font-mono text-sm font-bold">
            {['all', 'sales', 'stock', 'intelligence'].map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3.5 py-1.5 uppercase border-2 border-black transition-all ${
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

        {/* Horizontal Scroll Track */}
        <div className="flex overflow-x-auto gap-5 pb-6 pt-2 snap-x scrollbar-thin scrollbar-thumb-black">
          {filteredModules.map((m) => (
            <div
              key={m.id}
              className={`min-w-[320px] md:min-w-[360px] max-w-[380px] flex-shrink-0 p-5 bg-white border-2 border-black ${m.shadowColor} snap-start flex flex-col justify-between hover:-translate-y-1 transition-transform`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={`font-mono text-xs font-black px-2.5 py-1 border border-black ${m.badgeColor}`}>
                    MODULE {m.num}
                  </span>
                  <span className="font-mono text-xs font-bold text-muted bg-[#F3F4F6] px-2.5 py-1 border border-hair">
                    {m.tag}
                  </span>
                </div>

                <div className="text-xs uppercase font-mono font-bold text-navy mb-1">{m.tag}</div>
                <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">{m.title}</h3>
                <p className="text-base text-[#4B5563] leading-relaxed mb-4">{m.summary}</p>
              </div>

              <div className="pt-3 border-t-2 border-black flex items-center justify-between">
                <Link
                  to={m.path}
                  className="font-mono text-sm font-black text-black hover:text-[#4F46E5] flex items-center gap-1.5 group"
                >
                  Inspect Rules & Guide <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
                <span className="w-2.5 h-2.5 bg-black"></span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm font-mono text-muted">
          <span>← Swipe or scroll horizontally to explore all modules</span>
          <Link to="/help" className="text-black font-bold underline hover:text-[#4F46E5]">
            Open Full Functional Index in Help Manual →
          </Link>
        </div>
      </section>

      {/* Section 3: Daily Operating Workflows */}
      <section id="workflows" className="max-w-[1340px] mx-auto py-16 px-4 border-b-2 border-black">
        <div className="mb-10 text-center max-w-3xl mx-auto">
          <span className="bg-[#FEF3C7] text-[#B45309] font-mono text-xs font-bold uppercase px-3 py-1 border border-[#B45309] mb-3 inline-block">
            Standard Operating Procedures
          </span>
          <h2 className="text-3xl md:text-4xl font-serif font-black text-black mb-3">
            A Day in the Life with the System
          </h2>
          <p className="text-lg text-[#4B5563]">
            Follow standardized routines designed for maximum counter speed and inventory precision.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="p-5 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#4F46E5] flex flex-col justify-between">
            <div>
              <div className="w-9 h-9 bg-[#4F46E5] text-white font-mono font-black flex items-center justify-center mb-3 text-base">
                1
              </div>
              <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">Morning Review</h3>
              <p className="text-base text-[#4B5563] leading-relaxed mb-3">
                Open Restocking to check Critical alert titles. Review computed sales velocity and dispatch POs to the cheapest vendor with 1 click.
              </p>
            </div>
            <div className="pt-2 border-t border-hair font-mono text-xs text-navy font-bold">
              Route: #/restock
            </div>
          </div>

          <div className="p-5 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#059669] flex flex-col justify-between">
            <div>
              <div className="w-9 h-9 bg-[#059669] text-white font-mono font-black flex items-center justify-center mb-3 text-base">
                2
              </div>
              <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">Counter Checkout</h3>
              <p className="text-base text-[#4B5563] leading-relaxed mb-3">
                Scan barcode or type ISBN. Staff discount caps prevent unauthorized loss. Finalize bill on Enter and hand customer thermal slip.
              </p>
            </div>
            <div className="pt-2 border-t border-hair font-mono text-xs text-olive font-bold">
              Route: #/billing
            </div>
          </div>

          <div className="p-5 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#D97706] flex flex-col justify-between">
            <div>
              <div className="w-9 h-9 bg-[#D97706] text-white font-mono font-black flex items-center justify-center mb-3 text-base">
                3
              </div>
              <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">Receive Deliveries</h3>
              <p className="text-base text-[#4B5563] leading-relaxed mb-3">
                Check-in distributor boxes in Purchases. Partial deliveries accepted; inventory unit cost dynamically recalibrates for true P&L.
              </p>
            </div>
            <div className="pt-2 border-t border-hair font-mono text-xs text-ochre font-bold">
              Route: #/purchases
            </div>
          </div>

          <div className="p-5 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#BE123C] flex flex-col justify-between">
            <div>
              <div className="w-9 h-9 bg-[#BE123C] text-white font-mono font-black flex items-center justify-center mb-3 text-base">
                4
              </div>
              <h3 className="!mt-0 !mb-2 text-xl font-serif font-bold text-black">Closing Operations</h3>
              <p className="text-base text-[#4B5563] leading-relaxed mb-3">
                Review Dashboard for Net Sales and Gross Profit. Log daily overheads in Expenses. Keep historical audits pristine.
              </p>
            </div>
            <div className="pt-2 border-t border-hair font-mono text-xs text-brick font-bold">
              Route: #/dashboard
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Permissions & Role Matrix */}
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
                <th className="py-3 px-3.5">System Action</th>
                <th className="w-[140px] py-3 px-3.5">Staff Role</th>
                <th className="w-[140px] py-3 px-3.5">Owner Role</th>
                <th className="py-3 px-3.5">Enforcement Safeguard</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-3 px-3.5"><strong>Counter Billing & Sales</strong></td>
                <td><span className="px-2.5 py-1 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Active</span></td>
                <td><span className="px-2.5 py-1 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Active</span></td>
                <td className="text-muted text-sm">Staff discount is capped by shop setting. Higher discounts refused by server.</td>
              </tr>
              <tr>
                <td className="py-3 px-3.5"><strong>Void Invoices</strong></td>
                <td><span className="px-2.5 py-1 bg-[#FEE2E2] text-[#B91C1C] font-mono text-xs font-bold border border-[#B91C1C]">Refused (403)</span></td>
                <td><span className="px-2.5 py-1 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Authorized</span></td>
                <td className="text-muted text-sm">Voiding restores physical inventory and removes transaction from sales reports.</td>
              </tr>
              <tr>
                <td className="py-3 px-3.5"><strong>Wholesale Supplier Cost Data</strong></td>
                <td><span className="px-2.5 py-1 bg-[#FEE2E2] text-[#B91C1C] font-mono text-xs font-bold border border-[#B91C1C]">Hidden (403)</span></td>
                <td><span className="px-2.5 py-1 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Full Access</span></td>
                <td className="text-muted text-sm">Supplier wholesale prices and margin data are stripped from staff catalogue responses.</td>
              </tr>
              <tr>
                <td className="py-3 px-3.5"><strong>Physical Stock Audit Adjustments</strong></td>
                <td><span className="px-2.5 py-1 bg-[#FEE2E2] text-[#B91C1C] font-mono text-xs font-bold border border-[#B91C1C]">Refused (403)</span></td>
                <td><span className="px-2.5 py-1 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Authorized</span></td>
                <td className="text-muted text-sm">Requires counted quantity and mandatory audit reason written to movement log.</td>
              </tr>
              <tr>
                <td className="py-3 px-3.5"><strong>Financial P&L Dashboard</strong></td>
                <td><span className="px-2.5 py-1 bg-[#FEE2E2] text-[#B91C1C] font-mono text-xs font-bold border border-[#B91C1C]">Refused (403)</span></td>
                <td><span className="px-2.5 py-1 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border border-[#15803D]">Full Analytics</span></td>
                <td className="text-muted text-sm">Cost of goods sold, gross margin, and operating profit reports are owner-only.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1A1A1A] text-white border-t-4 border-black py-12 px-4">
        <div className="max-w-[1340px] mx-auto flex flex-wrap justify-between items-center gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-3 h-3 bg-[#CCFF00]"></span>
              <span className="font-serif font-black text-2xl text-white">Bookshop Automation System</span>
            </div>
            <div className="font-mono text-sm text-white/60">
              Multi-Store Retail & Franchise Architecture
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="px-4 py-2 bg-white/10 hover:bg-white hover:text-black text-white font-mono text-sm font-bold border border-white/30 transition-colors"
            >
              ↑ Top of Page
            </button>
            <Link
              to="/help"
              className="px-5 py-2 bg-[#CCFF00] text-black font-mono text-sm font-black uppercase tracking-wider border-2 border-black shadow-[3px_3px_0px_0px_#4F46E5] hover:bg-white transition-all flex items-center gap-2"
            >
              <BookOpen className="w-4 h-4 text-black" /> Open System Help Guide →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
