import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://swbdnpjkqoydqwyqnzoz.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Jt1DTLvzGODgzapa9NytYA_Ylro2Yec';

export const supabase = createClient(supabaseUrl, supabaseKey);

