import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ─── Supabase Client ─────────────────────────────────────────────────────────
// This is the ONLY file in the entire codebase that imports from @supabase/supabase-js.
// The three service files (db.ts, auth.ts, realtime.ts) import the client from here.
// Features import from services only — they never reach this file.
//
// To migrate to AWS: delete this file and update the three service files only.

let client: SupabaseClient | null = null

export function initSupabaseClient(url: string, anonKey: string): SupabaseClient {
  client = createClient(url, anonKey, {
    auth: {
      persistSession: false,   // We manage the session ourselves via SecretStorage
      autoRefreshToken: true,
    },
  })
  return client
}

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    throw new Error('Supabase client not initialised. Call initSupabaseClient first.')
  }
  return client
}
