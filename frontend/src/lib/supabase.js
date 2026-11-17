import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://swbdnpjkqoydqwyqnzoz.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Jt1DTLvzGODgzapa9NytYA_Ylro2Yec';

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Multi-Franchise Default Stores
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

    if (!error && data && data.length > 0) {
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

/**
 * Realtime Event Bus via Supabase Realtime & Window Broadcast
 */
let realtimeChannel = null;

export function getRealtimeChannel() {
  if (!realtimeChannel && supabase) {
    try {
      realtimeChannel = supabase.channel('bookshop-live-events', {
        config: { broadcast: { self: true } },
      }).subscribe();
    } catch (e) {
      console.warn('Supabase channel init warning:', e);
    }
  }
  return realtimeChannel;
}

export function broadcastEvent(event, payload = {}) {
  // 1. Dispatch local event across active application components
  try {
    window.dispatchEvent(new CustomEvent(`bookshop:${event}`, { detail: payload }));
    window.dispatchEvent(new CustomEvent('bookshop:activity', { detail: { event, payload } }));
  } catch {}

  // 2. Broadcast across tabs and devices via Supabase Realtime
  try {
    const channel = getRealtimeChannel();
    if (channel) {
      channel.send({
        type: 'broadcast',
        event,
        payload,
      });
    }
  } catch (err) {
    console.warn('Realtime broadcast warning:', err);
  }
}

export function subscribeToActivity(callback) {
  const handleLocal = (e) => callback(e.detail);
  window.addEventListener('bookshop:activity', handleLocal);

  let channel = null;
  try {
    channel = getRealtimeChannel();
    if (channel) {
      channel.on('broadcast', { event: '*' }, (data) => {
        callback({ event: data.event, payload: data.payload });
      });
    }
  } catch {}

  return () => {
    window.removeEventListener('bookshop:activity', handleLocal);
  };
}
