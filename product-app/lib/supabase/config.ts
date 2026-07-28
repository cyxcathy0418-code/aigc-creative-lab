export function getSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
  };
}

export function hasSupabaseEnv() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}
