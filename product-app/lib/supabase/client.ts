import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

export function createBrowserSupabaseClient() {
  const { url, anonKey } = getSupabaseConfig();

  if (!url || !anonKey) {
    throw new Error("Supabase browser configuration is missing.");
  }

  return createBrowserClient(url, anonKey);
}

export function createImplicitLoginClient() {
  const { url, anonKey } = getSupabaseConfig();

  if (!url || !anonKey) {
    throw new Error("Supabase browser configuration is missing.");
  }

  return createClient(url, anonKey, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: false,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
