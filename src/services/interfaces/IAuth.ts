import * as vscode from 'vscode'
import { User } from '../../types'

// ─── IAuth ───────────────────────────────────────────────────────────────────
// Identity management. Features and the extension host call these methods.
// The implementation details of which auth provider is used live in auth.ts only.

export interface IAuth {
  // Initiates the OAuth flow — opens browser, begins the sign-in sequence
  signIn(): Promise<void>

  // Closes the session and clears stored credentials
  signOut(secrets: vscode.SecretStorage): Promise<void>

  // Receives the OAuth redirect URI and extracts the session from it
  // Returns the authenticated user, or null if the invitation check failed
  handleOAuthCallback(uri: vscode.Uri, secrets: vscode.SecretStorage): Promise<User | null>

  // Attempts to restore a previous session from SecretStorage
  // Returns the user if the session is still valid, null if expired or missing
  restoreSession(secrets: vscode.SecretStorage): Promise<User | null>

  // Returns the currently authenticated user without making a network call
  getCurrentUser(): Promise<User | null>
}
