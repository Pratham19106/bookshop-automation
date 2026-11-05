const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://swbdnpjkqoydqwyqnzoz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Jt1DTLvzGODgzapa9NytYA_Ylro2Yec';

let client = null;
try {
  if (supabaseUrl && supabaseKey) {
    client = createClient(supabaseUrl, supabaseKey);
  }
} catch (err) {
  console.warn('Supabase client failed to initialize:', err.message);
}

/**
 * Asynchronously syncs a newly registered business and its franchises to Supabase
 */
async function syncBusinessToSupabase({ business, outlets, user }) {
  if (!client) return;
  try {
    // 1. Sync business
    await client.from('businesses').upsert({
      id: business.id,
      name: business.name,
      slug: business.slug,
      owner_name: business.ownerName || business.name,
      email: business.email,
      phone: business.phone || '',
    });

    // 2. Sync franchises
    if (Array.isArray(outlets) && outlets.length >= 2) {
      const rows = outlets.map((o) => ({
        id: o.id,
        business_id: business.id,
        code: o.code,
        name: o.name,
        city: o.city || 'Hyderabad',
        address: o.address || '',
        phone: o.phone || '',
        email: business.email || '',
        status: 'active',
        is_headquarters: !!o.isHeadquarters,
      }));
      await client.from('franchises').upsert(rows);
    }

    // 3. Sync user
    if (user) {
      await client.from('users').upsert({
        username: user.username,
        full_name: user.fullName,
        password_hash: '$2a$10$managed_via_backend',
        role: user.role || 'owner',
        business_id: business.id,
        active: true,
      });
    }
  } catch (err) {
    console.warn('Background Supabase sync skipped:', err.message);
  }
}

module.exports = {
  supabase: client,
  syncBusinessToSupabase,
};
