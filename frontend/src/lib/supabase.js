import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://swbdnpjkqoydqwyqnzoz.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Jt1DTLvzGODgzapa9NytYA_Ylro2Yec';

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Multi-Franchise Default Stores (Ensures at least 2 franchises are always supportable)
 */
export const DEFAULT_FRANCHISES = [
  {
    id: 'fr_kukatpally',
    code: 'FR-001',
    name: 'Srinivasa Book Store - Kukatpally (HQ)',
    city: 'Hyderabad',
    address: 'Main Road, Kukatpally, Hyderabad - 500 072',
    phone: '040-6455 5452',
    status: 'active',
    is_headquarters: true,
  },
  {
    id: 'fr_hitec',
    code: 'FR-002',
    name: 'Srinivasa Book Store - Cyber Towers',
    city: 'Hyderabad',
    address: 'Ground Floor, Cyber Gateway, Hitec City, Hyderabad - 500 081',
    phone: '040-6788 9900',
    status: 'active',
    is_headquarters: false,
  },
];

/**
 * Fetch all available franchises from Supabase with fallback to DEFAULT_FRANCHISES
 */
export async function getFranchises() {
  try {
    const { data, error } = await supabase
      .from('franchises')
      .select('*')
      .eq('status', 'active')
      .order('is_headquarters', { ascending: false });

    if (!error && data && data.length >= 2) {
      return data;
    }
  } catch (err) {
    console.warn('Using default multi-franchise configuration:', err);
  }
  return DEFAULT_FRANCHISES;
}

/**
 * Fetch books catalogue from Supabase
 */
export async function getBooksCatalogue(genre = null) {
  try {
    let query = supabase.from('books').select('*').eq('active', true);
    if (genre) {
      query = query.eq('genre', genre);
    }
    const { data, error } = await query;
    if (!error && data) return data;
  } catch (err) {
    console.warn('Supabase getBooksCatalogue error:', err);
  }
  return [];
}

