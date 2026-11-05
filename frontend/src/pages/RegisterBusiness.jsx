import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAction, Field } from '../lib/ui';

export default function RegisterBusiness() {
  const { registerBusiness } = useAuth();
  const navigate = useNavigate();

  // Business Information
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Owner Credentials
  const [ownerName, setOwnerName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Outlets List (Enforcing >= 2 outlets constraint)
  const [outlets, setOutlets] = useState([
    {
      name: 'Central Flagship Store (HQ)',
      city: 'Hyderabad',
      address: 'Main Commercial Boulevard, Road No. 1, Banjara Hills',
      phone: '040-6500 1122',
      isHeadquarters: true,
    },
    {
      name: 'Cyber Gateway Outlet',
      city: 'Hyderabad',
      address: 'Ground Floor, Tech Park, Hitec City',
      phone: '040-6500 3344',
      isHeadquarters: false,
    },
  ]);

  const [err, setErr] = useState('');
  const [success, setSuccess] = useState(false);

  const [submit, busy] = useAction(async (e) => {
    e?.preventDefault?.();
    setErr('');

    if (!businessName.trim()) {
      setErr('Please enter the bookshop chain / business name.');
      return;
    }
    if (!ownerName.trim()) {
      setErr('Please enter the owner full name.');
      return;
    }
    if (!username.trim() || username.length < 3) {
      setErr('Username must be at least 3 characters.');
      return;
    }
    if (!password || password.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    if (outlets.length < 2) {
      setErr('Constraint Violation: A minimum of 2 outlets is required for multi-franchise chain registration.');
      return;
    }
    for (let i = 0; i < outlets.length; i++) {
      if (!outlets[i].name.trim()) {
        setErr(`Outlet #${i + 1} must have a branch name.`);
        return;
      }
    }

    try {
      const res = await registerBusiness({
        businessName: businessName.trim(),
        ownerName: ownerName.trim(),
        username: username.trim(),
        password,
        email: email.trim(),
        phone: phone.trim(),
        outlets,
      });
      setSuccess(true);
      setTimeout(() => {
        navigate('/dashboard');
      }, 600);
    } catch (e) {
      setErr(e.message || 'Registration failed. Please check the provided information.');
    }
  });

  const updateOutlet = (index, key, val) => {
    setOutlets((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [key]: val };
      if (key === 'isHeadquarters' && val) {
        // Only one HQ allowed
        copy.forEach((o, i) => {
          if (i !== index) o.isHeadquarters = false;
        });
      }
      return copy;
    });
  };

  const addOutlet = () => {
    setOutlets((prev) => [
      ...prev,
      {
        name: `Branch Outlet ${prev.length + 1}`,
        city: 'Hyderabad',
        address: '',
        phone: '',
        isHeadquarters: false,
      },
    ]);
  };

  const removeOutlet = (index) => {
    if (outlets.length <= 2) {
      setErr('System constraint requires at least 2 active outlets for any registered bookshop chain.');
      return;
    }
    setOutlets((prev) => {
      const filtered = prev.filter((_, i) => i !== index);
      if (!filtered.some((o) => o.isHeadquarters)) {
        filtered[0].isHeadquarters = true;
      }
      return filtered;
    });
  };

  const prefillDemo = (chainName, owner, user, pass, city1, city2) => {
    setBusinessName(chainName);
    setEmail(`contact@${chainName.toLowerCase().replace(/[^a-z0-9]/g, '')}.example`);
    setPhone('+91 98765 43210');
    setOwnerName(owner);
    setUsername(user);
    setPassword(pass);
    setOutlets([
      {
        name: `${chainName} - ${city1} Flagship (HQ)`,
        city: city1,
        address: `100 Commercial Boulevard, ${city1}`,
        phone: '040-6100 1111',
        isHeadquarters: true,
      },
      {
        name: `${chainName} - ${city2} Uptown Mall`,
        city: city2,
        address: `Level 2, Phoenix Center, ${city2}`,
        phone: '040-6200 2222',
        isHeadquarters: false,
      },
    ]);
    setErr('');
  };

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-ink font-sans flex flex-col justify-center px-4 py-10 selection:bg-[#CCFF00] selection:text-black">
      <div className="max-w-[760px] w-full mx-auto animate-stamp">
        <div className="bg-white border-2 border-black p-6 sm:p-8 shadow-[8px_8px_0px_0px_#1A1A1A] relative">
          
          {/* Top Badge */}
          <div className="absolute -top-3.5 -right-3.5 bg-[#CCFF00] text-black font-mono font-black text-xs px-3 py-1 border-2 border-black shadow-[2px_2px_0px_0px_#1A1A1A] uppercase rotate-2">
            Multi-Tenant Onboarding ⚡
          </div>

          <div className="flex flex-wrap items-center justify-between pb-4 mb-6 border-b-2 border-black gap-2">
            <div>
              <div className="text-[.72rem] uppercase tracking-wider font-mono font-bold text-[#4F46E5] flex items-center gap-1.5">
                <span>🏢 Chain Registration</span>
                <span className="w-1.5 h-1.5 bg-[#4F46E5] rounded-full"></span>
                <span>Multi-Outlet Architecture</span>
              </div>
              <h1 className="!border-0 !mb-0 text-3xl font-serif font-black text-black">
                Register New Bookshop Chain
              </h1>
            </div>
            <span className="inline-block px-2.5 py-1 bg-[#EEF2FF] text-[#4F46E5] font-mono text-xs font-bold border-2 border-[#4F46E5]">
              Constraint: ≥ 2 Outlets
            </span>
          </div>

          {/* Quick Demo Pre-fill Bar */}
          <div className="mb-6 p-3 bg-[#FEFCE8] border-2 border-black">
            <div className="text-[.7rem] uppercase font-mono font-bold text-black mb-1.5 flex items-center justify-between">
              <span>⚡ Fast-Fill Sample Bookshop Chain:</span>
              <span className="text-muted font-normal">Click to fill</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => prefillDemo('Oxford Corner Books', 'Vikram Patel', `oxford_${Math.floor(Math.random()*900+100)}`, 'Password123', 'Mumbai', 'Pune')}
                className="btn btn-sm bg-white hover:bg-black hover:text-[#CCFF00] text-black border-2 border-black font-mono text-xs font-bold shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                + Oxford Books (Mumbai & Pune)
              </button>
              <button
                type="button"
                onClick={() => prefillDemo('Crossword Horizons', 'Priya Desai', `crossword_${Math.floor(Math.random()*900+100)}`, 'Password123', 'Hyderabad', 'Bengaluru')}
                className="btn btn-sm bg-white hover:bg-black hover:text-[#38BDF8] text-black border-2 border-black font-mono text-xs font-bold shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                + Crossword Horizons (Hyd & Blr)
              </button>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-6">
            
            {/* 1. Chain Entity Information */}
            <div className="p-4 bg-[#FAF9F5] border-2 border-black">
              <h2 className="text-sm font-mono font-black uppercase text-black mb-3 flex items-center gap-2">
                <span className="w-5 h-5 bg-[#1A1A1A] text-[#CCFF00] flex items-center justify-center text-xs">1</span>
                Bookshop Chain Details
              </h2>
              <div className="grid sm:grid-cols-2 gap-3.5">
                <div className="sm:col-span-2">
                  <Field label="Bookshop Chain / Brand Name" htmlFor="bizName">
                    <input
                      id="bizName"
                      className="input font-sans text-sm font-semibold"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="e.g. Oxford Bookstores or Crossword Chain"
                      required
                    />
                  </Field>
                </div>
                <div>
                  <Field label="Business Email" htmlFor="bizEmail">
                    <input
                      id="bizEmail"
                      type="email"
                      className="input font-mono text-xs"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="contact@bookstore.example"
                      required
                    />
                  </Field>
                </div>
                <div>
                  <Field label="Contact Phone" htmlFor="bizPhone">
                    <input
                      id="bizPhone"
                      className="input font-mono text-xs"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* 2. Chain Owner / Super-Admin Credentials */}
            <div className="p-4 bg-[#FAF9F5] border-2 border-black">
              <h2 className="text-sm font-mono font-black uppercase text-black mb-3 flex items-center gap-2">
                <span className="w-5 h-5 bg-[#1A1A1A] text-[#CCFF00] flex items-center justify-center text-xs">2</span>
                Owner & Super-Admin Credentials
              </h2>
              <div className="grid sm:grid-cols-3 gap-3.5">
                <div>
                  <Field label="Owner Full Name" htmlFor="ownerName">
                    <input
                      id="ownerName"
                      className="input font-sans text-xs font-semibold"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="e.g. Vikram Patel"
                      required
                    />
                  </Field>
                </div>
                <div>
                  <Field label="Admin Username" htmlFor="username">
                    <input
                      id="username"
                      className="input font-mono text-xs"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. vpatel"
                      autoComplete="username"
                      required
                    />
                  </Field>
                </div>
                <div>
                  <Field label="Master Password" htmlFor="password">
                    <input
                      id="password"
                      type="password"
                      className="input font-mono text-xs"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      required
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* 3. Outlets Repeater (Enforcing >= 2 outlets) */}
            <div className="p-4 bg-[#FAF9F5] border-2 border-black">
              <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
                <h2 className="text-sm font-mono font-black uppercase text-black flex items-center gap-2">
                  <span className="w-5 h-5 bg-[#1A1A1A] text-[#CCFF00] flex items-center justify-center text-xs">3</span>
                  Franchise Outlets Setup ({outlets.length} Branches)
                </h2>
                <span className="text-[.7rem] font-mono font-bold text-[#15803D] bg-[#DCFCE7] px-2 py-0.5 border border-[#15803D]">
                  ✓ Constraint Satisfied (≥ 2)
                </span>
              </div>

              <p className="text-xs text-[#4B5563] mb-4">
                Each registered bookshop chain must maintain at least 2 distinct physical outlets. You can assign one as Headquarters.
              </p>

              <div className="space-y-3.5">
                {outlets.map((outlet, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 border-2 ${
                      outlet.isHeadquarters ? 'border-[#4F46E5] bg-[#F5F3FF]' : 'border-black bg-white'
                    } shadow-[3px_3px_0px_0px_#1A1A1A]`}
                  >
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-300">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-black bg-black text-white px-2 py-0.5">
                          Outlet #{idx + 1}
                        </span>
                        {outlet.isHeadquarters && (
                          <span className="bg-[#4F46E5] text-white font-mono text-[10px] font-bold px-2 py-0.5 uppercase">
                            Headquarters (HQ)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-xs font-mono font-bold cursor-pointer flex items-center gap-1 select-none">
                          <input
                            type="checkbox"
                            checked={!!outlet.isHeadquarters}
                            onChange={(e) => updateOutlet(idx, 'isHeadquarters', e.target.checked)}
                            className="checkbox"
                          />
                          <span>HQ</span>
                        </label>
                        {outlets.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeOutlet(idx)}
                            className="text-xs text-red-600 hover:text-red-800 font-mono font-bold px-1.5 py-0.5 border border-red-300"
                            title="Remove this branch"
                          >
                            ✕ Remove
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-2.5">
                      <div>
                        <Field label="Branch / Outlet Name">
                          <input
                            className="input font-sans text-xs font-medium"
                            value={outlet.name}
                            onChange={(e) => updateOutlet(idx, 'name', e.target.value)}
                            placeholder="e.g. Flagship Store (HQ)"
                            required
                          />
                        </Field>
                      </div>
                      <div>
                        <Field label="City">
                          <input
                            className="input font-sans text-xs"
                            value={outlet.city}
                            onChange={(e) => updateOutlet(idx, 'city', e.target.value)}
                            placeholder="e.g. Hyderabad"
                            required
                          />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="Physical Address">
                          <input
                            className="input font-sans text-xs"
                            value={outlet.address}
                            onChange={(e) => updateOutlet(idx, 'address', e.target.value)}
                            placeholder="Shop 101, Commercial Avenue, Landmark"
                          />
                        </Field>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3.5">
                <button
                  type="button"
                  onClick={addOutlet}
                  className="btn btn-sm bg-white hover:bg-black hover:text-[#CCFF00] border-2 border-black font-mono text-xs font-bold shadow-[2px_2px_0px_0px_#1A1A1A] w-full py-2"
                >
                  + Add Another Outlet / Branch
                </button>
              </div>
            </div>

            {err && (
              <div className="p-3 bg-[#FEE2E2] border-2 border-[#B91C1C] text-[#7F1D1D] font-mono text-xs font-bold animate-slide-up">
                ⚠ {err}
              </div>
            )}

            {success && (
              <div className="p-3 bg-[#DCFCE7] border-2 border-[#15803D] text-[#15803D] font-mono text-xs font-bold animate-slide-up">
                ✓ Business and outlets created successfully! Launching terminal workspace…
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full py-3.5 text-sm uppercase tracking-wider font-mono font-bold shadow-[4px_4px_0px_0px_#4F46E5]"
              disabled={busy || success}
            >
              {busy ? 'Registering Chain & Outlets…' : 'Onboard Business Chain & Open Terminal →'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t-2 border-black flex flex-wrap items-center justify-between gap-3 text-xs font-mono font-bold">
            <Link to="/login" className="text-[#4F46E5] hover:underline">
              ← Already registered? Sign in here
            </Link>
            <Link to="/landing" className="text-black hover:underline">
              ← Platform Overview
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

