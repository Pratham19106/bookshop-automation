import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAction, Field } from '../lib/ui';
import { Building2, Zap, Sparkles, AlertTriangle, CheckCircle2, Trash2, Plus } from 'lucide-react';

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

  // Outlets List (Optional during initial business onboarding)
  const [outlets, setOutlets] = useState([
    {
      name: '',
      city: '',
      address: '',
      phone: '',
      isHeadquarters: true,
    },
  ]);

  const [err, setErr] = useState('');
  const [success, setSuccess] = useState(false);

  const [submit, busy] = useAction(async (e) => {
    e?.preventDefault?.();
    setErr('');

    if (!businessName.trim()) {
      setErr('Please enter the bookshop business / chain name.');
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
    for (let i = 0; i < outlets.length; i++) {
      if (!outlets[i].name.trim()) {
        setErr(`Outlet #${i + 1} must have a valid branch name.`);
        return;
      }
    }

    try {
      await registerBusiness({
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
        name: ``,
        city: '',
        address: '',
        phone: '',
        isHeadquarters: prev.length === 0,
      },
    ]);
  };

  const removeOutlet = (index) => {
    setOutlets((prev) => {
      const filtered = prev.filter((_, i) => i !== index);
      if (filtered.length > 0 && !filtered.some((o) => o.isHeadquarters)) {
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
        name: `${chainName} - ${city2} Uptown Branch`,
        city: city2,
        address: `Level 2, Phoenix Centre, ${city2}`,
        phone: '040-6200 2222',
        isHeadquarters: false,
      },
    ]);
    setErr('');
  };

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-ink font-sans flex flex-col justify-center px-4 py-10 selection:bg-[#CCFF00] selection:text-black text-base">
      <div className="max-w-[800px] w-full mx-auto animate-stamp">
        <div className="bg-white border-2 border-black p-6 sm:p-9 shadow-[8px_8px_0px_0px_#1A1A1A] relative">
          

          <div className="flex flex-wrap items-center justify-between pb-4 mb-6 border-b-2 border-black gap-2">
            <div>
              <h1 className="!border-0 !mb-0 text-3xl sm:text-4xl font-serif font-black text-black mt-1">
                Register Your Bookshop Business
              </h1>
            </div>
            <span className="inline-block px-3 py-1 bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold border-2 border-[#15803D]">
              Direct Setup
            </span>
          </div>

          <form onSubmit={submit} className="space-y-6">
            
            {/* 1. Chain Entity Information */}
            <div className="p-5 bg-[#FAF9F5] border-2 border-black">
              <h2 className="text-base font-mono font-black uppercase text-black mb-3.5 flex items-center gap-2">
                <span className="w-6 h-6 bg-[#1A1A1A] text-[#CCFF00] flex items-center justify-center text-xs">1</span>
                Bookshop Business Details
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Bookshop Name / Brand" htmlFor="bizName">
                    <input
                      id="bizName"
                      className="input font-sans text-base font-semibold py-2.5"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder=""
                      required
                    />
                  </Field>
                </div>
                <div>
                  <Field label="Business Email" htmlFor="bizEmail">
                    <input
                      id="bizEmail"
                      type="email"
                      className="input font-mono text-sm py-2"
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
                      className="input font-mono text-sm py-2"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 XXXXX XXXXX"
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* 2. Chain Owner / Super-Admin Credentials */}
            <div className="p-5 bg-[#FAF9F5] border-2 border-black">
              <h2 className="text-base font-mono font-black uppercase text-black mb-3.5 flex items-center gap-2">
                <span className="w-6 h-6 bg-[#1A1A1A] text-[#CCFF00] flex items-center justify-center text-xs">2</span>
                Owner Credentials
              </h2>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <Field label="Owner Full Name" htmlFor="ownerName">
                    <input
                      id="ownerName"
                      className="input font-sans text-sm font-semibold py-2"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="Owner"
                      required
                    />
                  </Field>
                </div>
                <div>
                  <Field label="Admin Username" htmlFor="username">
                    <input
                      id="username"
                      className="input font-mono text-sm py-2"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="username"
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
                      className="input font-mono text-sm py-2"
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

            {/* 3. Outlets Repeater (Optional during registration) */}
            <div className="p-5 bg-[#FAF9F5] border-2 border-black">
              <div className="flex flex-wrap items-center justify-between mb-2.5 gap-2">
                <h2 className="text-base font-mono font-black uppercase text-black flex items-center gap-2">
                  <span className="w-6 h-6 bg-[#1A1A1A] text-[#CCFF00] flex items-center justify-center text-xs">3</span>
                  Storefronts & Outlets ({outlets.length} Configured)
                </h2>
                <span className="text-xs font-mono font-bold text-[#4F46E5] bg-[#EEF2FF] px-2.5 py-1 border border-[#4F46E5]">
                  Add Outlets Now or Later
                </span>
              </div>

              <p className="text-sm text-[#4B5563] mb-4">
                Configure your physical stores and branches below with their individual addresses, or skip and add them anytime from the app.
              </p>

              {outlets.length === 0 ? (
                <div className="p-5 bg-white border-2 border-dashed border-gray-400 text-center mb-3 text-sm text-muted font-mono">
                  No outlets added yet. You can register your business first and create stores later.
                </div>
              ) : (
                <div className="space-y-4">
                  {outlets.map((outlet, idx) => (
                    <div
                      key={idx}
                      className={`p-4 border-2 ${
                        outlet.isHeadquarters ? 'border-[#4F46E5] bg-[#F5F3FF]' : 'border-black bg-white'
                      } shadow-[3px_3px_0px_0px_#1A1A1A]`}
                    >
                      <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-gray-300">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-black bg-black text-white px-2.5 py-1">
                            Shop #{idx + 1}
                          </span>
                          {outlet.isHeadquarters && (
                            <span className="bg-[#4F46E5] text-white font-mono text-xs font-bold px-2.5 py-1 uppercase">
                              Headquarters (HQ)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <label className="text-xs font-mono font-bold cursor-pointer flex items-center gap-1.5 select-none">
                            <input
                              type="checkbox"
                              checked={!!outlet.isHeadquarters}
                              onChange={(e) => updateOutlet(idx, 'isHeadquarters', e.target.checked)}
                              className="checkbox"
                            />
                            <span>HQ</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => removeOutlet(idx)}
                            className="text-xs text-red-600 hover:text-red-800 font-mono font-bold px-2 py-1 border border-red-300 flex items-center gap-1 hover:bg-red-50"
                            title="Remove this branch"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remove
                          </button>
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <Field label="Store / Outlet Name">
                            <input
                              className="input font-sans text-sm font-medium py-2"
                              value={outlet.name}
                              onChange={(e) => updateOutlet(idx, 'name', e.target.value)}
                              placeholder=""
                              required
                            />
                          </Field>
                        </div>
                        <div>
                          <Field label="City">
                            <input
                              className="input font-sans text-sm py-2"
                              value={outlet.city}
                              onChange={(e) => updateOutlet(idx, 'city', e.target.value)}
                              placeholder=""
                              required
                            />
                          </Field>
                        </div>
                        <div className="sm:col-span-2">
                          <Field label="Physical Address (Unique to this Shop)">
                            <input
                              className="input font-sans text-sm py-2"
                              value={outlet.address}
                              onChange={(e) => updateOutlet(idx, 'address', e.target.value)}
                              placeholder=""
                            />
                          </Field>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4">
                <button
                  type="button"
                  onClick={addOutlet}
                  className="btn btn-sm bg-white hover:bg-black hover:text-[#CCFF00] border-2 border-black font-mono text-sm font-bold shadow-[2px_2px_0px_0px_#1A1A1A] w-full py-2.5 flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add Store / Outlet with Unique Address
                </button>
              </div>
            </div>

            {err && (
              <div className="p-3.5 bg-[#FEE2E2] border-2 border-[#B91C1C] text-[#7F1D1D] font-mono text-sm font-bold animate-slide-up flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#B91C1C] flex-shrink-0" />
                <span>{err}</span>
              </div>
            )}

            {success && (
              <div className="p-3.5 bg-[#DCFCE7] border-2 border-[#15803D] text-[#15803D] font-mono text-sm font-bold animate-slide-up flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#15803D] flex-shrink-0" />
                <span>Business created successfully! Launching terminal workspace…</span>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full py-4 text-base uppercase tracking-wider font-mono font-bold shadow-[4px_4px_0px_0px_#4F46E5]"
              disabled={busy || success}
            >
              {busy ? 'Registering Business…' : 'Complete Registration & Open Terminal →'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t-2 border-black flex flex-wrap items-center justify-between gap-3 text-sm font-mono font-bold">
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
