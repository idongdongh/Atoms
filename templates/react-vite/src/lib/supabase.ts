import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Null when the platform did not inject Supabase config (e.g. local runs
// without credentials); components should fall back to in-memory state.
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
