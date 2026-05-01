import * as vscode from 'vscode'
import { IAuth } from '../interfaces/IAuth'
import { getSupabaseClient } from './client'
import { User } from '../../core/models'

const SECRET_JWT = 'collar.supabaseJWT'
const SECRET_REFRESH = 'collar.supabaseRefreshToken'

// ─── SupabaseAuth ─────────────────────────────────────────────────────────────
// Handles the full Supabase + GitHub OAuth lifecycle.
//
// Migration note: to move to AWS Cognito, implement IAuth using
// Auth.federatedSignIn() instead of supabase.auth.signInWithOAuth().
// The method signatures and what they return stay the same.

export class SupabaseAuth implements IAuth {

  // Initiates the OAuth flow.
  // Opens GitHub in the browser. The OS will redirect back to vscode:// when done.
  // The URI handler in extension.ts catches the redirect and calls handleOAuthCallback.
  async signIn(): Promise<void> {
     console.log('[Collar] Attempting sign in...') 
    const { data, error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: 'github',
      options: {
        scopes: 'user:email',
        redirectTo: 'vscode://collar.collar/auth/callback',
        skipBrowserRedirect: true,
      },
    })
    console.log('[Collar] Sign in error:', error) 
    if (error) throw new Error(`Sign in failed: ${error.message}`)

    if (data.url) {
    console.log('[Collar] Opening browser:', data.url)
    await vscode.env.openExternal(vscode.Uri.parse(data.url))
  }
  }

  // Clears the Supabase session and removes stored credentials.
  async signOut(secrets: vscode.SecretStorage): Promise<void> {
    await getSupabaseClient().auth.signOut()
    await secrets.delete(SECRET_JWT)
    await secrets.delete(SECRET_REFRESH)
  }

  // Called by the URI handler when Supabase redirects back to vscode://.
  // Extracts tokens from the URI fragment, establishes the session,
  // stores credentials, and returns the authenticated user.
  // Returns null if the DB trigger rejected the sign-in (no invitation).
  async handleOAuthCallback(uri: vscode.Uri, secrets: vscode.SecretStorage): Promise<User | null> {
    const params = new URLSearchParams(uri.fragment)
    const errorDescription = params.get('error_description')

    // The DB trigger raised an exception — no invitation found
    if (errorDescription) {
      console.error('[Collar] Auth denied:', errorDescription)
      return null
    }

    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (!accessToken || !refreshToken) {
      throw new Error('OAuth callback missing tokens')
    }

    const { error } = await getSupabaseClient().auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    if (error) throw new Error(`Failed to set session: ${error.message}`)

    // Store credentials for silent restore on next launch
    await secrets.store(SECRET_JWT, accessToken)
    await secrets.store(SECRET_REFRESH, refreshToken)

    return this.getCurrentUser()
  }

  // Attempts to restore a previous session silently.
  // Called on every launch before showing any UI.
  async restoreSession(secrets: vscode.SecretStorage): Promise<User | null> {
    const accessToken = await secrets.get(SECRET_JWT)
    const refreshToken = await secrets.get(SECRET_REFRESH)

    if (!accessToken || !refreshToken) return null

    const { error } = await getSupabaseClient().auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    // Session expired or invalid — clear stored credentials
    if (error) {
      await secrets.delete(SECRET_JWT)
      await secrets.delete(SECRET_REFRESH)
      return null
    }

    return this.getCurrentUser()
  }

  // Returns the current user from the active Supabase session.
  async getCurrentUser(): Promise<User | null> {
    const { data, error } = await getSupabaseClient().auth.getUser()
    if (error || !data.user) return null

    // Fetch the full user record from public.users (includes role)
    const { data: userRecord, error: userError } = await getSupabaseClient()
      .from('users')
      .select('id, name, email, role')
      .eq('id', data.user.id)
      .single()

    if (userError || !userRecord) return null
    return userRecord as User
  }
}

export const auth: IAuth = new SupabaseAuth()
