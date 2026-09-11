import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The web app runs fully standalone (no backend required) unless these two
// env vars are set — see .env.example. Both are safe to ship in the browser
// bundle: the anon key only ever acts within the Row Level Security policies
// defined in supabase/migrations/0001_init_schema.sql (a signed-in driver can
// only ever read/write their own rows). Never put the service_role key here.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, anonKey!) : null;
