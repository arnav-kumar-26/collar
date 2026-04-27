import * as vscode from 'vscode'
import { initSupabaseClient } from './core/supabase'
import { startFileWatcher } from './core/fileWatcher'
import { startGitTracker, getCurrentBranch } from './core/gitTracker'
import { registerViolationDetection, initViolationDetection } from './features/violation-detection/index'
import { registerHighlighter, disposeHighlighter } from './features/violation-detection/highlighter'
import { registerNotifications, initStatusBar } from './features/notifications/index'
import { registerGitIntegration } from './features/git-integration/index'
import { SidebarProvider } from './sidebar/SidebarProvider'
import { auth } from './services/auth'
import { db } from './services/db'
import { realtime } from './services/realtime'
import { eventBus } from './core/eventBus'

const SECRET_URL = 'collar.supabaseUrl'
const SECRET_KEY = 'collar.supabaseAnonKey'

export async function activate(context: vscode.ExtensionContext) {
  console.log('[Collar] Activating...')

  // ── Sidebar ──────────────────────────────────────────────────────────────
  const sidebarProvider = new SidebarProvider(context.extensionUri)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('collar.sidebar', sidebarProvider)
  )

  // ── Status bar (always visible, even before sign-in) ─────────────────────
  context.subscriptions.push(initStatusBar())

  // ── URI Handler — catches the Supabase OAuth redirect ────────────────────
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri: vscode.Uri) => {
        if (uri.path !== '/auth/callback') return

        const user = await auth.handleOAuthCallback(uri, context.secrets)

        if (!user) {
          // DB trigger rejected sign-in — no invitation found
          sidebarProvider['view']?.webview.postMessage({ type: 'authDenied' })
          vscode.window.showErrorMessage(
            'Collar: Access denied. Ask your admin to add your GitHub email to the invitation list.'
          )
          return
        }

        sidebarProvider.setUser(user)
        sidebarProvider['view']?.webview.postMessage({ type: 'authSuccess', data: user })
        await startPostAuthFlow(context, sidebarProvider, user.id)
      }
    })
  )

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('collar.signIn', async () => {
      const url = await context.secrets.get(SECRET_URL)
      const key = await context.secrets.get(SECRET_KEY)

      if (!url || !key) {
        await promptForCredentials(context)
      }
      await auth.signIn()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('collar.signOut', async () => {
      await auth.signOut(context.secrets)
      vscode.window.showInformationMessage('Collar: Signed out')
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('collar.triggerAnalysis', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showWarningMessage('Collar: Open a file to analyse')
        return
      }

      eventBus.emit('file:saved', {
        filePath: editor.document.uri.fsPath,
        contents: editor.document.getText(),
      })
    })
  )

  // ── Attempt silent session restore ────────────────────────────────────────
  await initialise(context, sidebarProvider)
}

// ─── Initialise ───────────────────────────────────────────────────────────────
// Runs on every launch. Checks what credentials exist and either restores
// the session silently or shows the appropriate onboarding step.

async function initialise(
  context: vscode.ExtensionContext,
  sidebarProvider: SidebarProvider
): Promise<void> {
  const url = await context.secrets.get(SECRET_URL)
  const key = await context.secrets.get(SECRET_KEY)

  if (!url || !key) {
    // First launch — no credentials at all
    // The sidebar will show the sign-in screen (handled by the React app)
    return
  }

  // Credentials exist — boot the Supabase client
  initSupabaseClient(url, key)
  initViolationDetection(url)

  // Try to restore the previous session
  const user = await auth.restoreSession(context.secrets)

  if (!user) {
    // Session expired — user needs to sign in again
    vscode.window.showInformationMessage('Collar: Session expired. Please sign in again.', 'Sign In')
      .then(selection => {
        if (selection === 'Sign In') vscode.commands.executeCommand('collar.signIn')
      })
    return
  }

  await startPostAuthFlow(context, sidebarProvider, user.id)
  sidebarProvider.setUser(user)
}

// ─── Post Auth Flow ───────────────────────────────────────────────────────────
// Everything that requires an authenticated session.
// Called after successful sign-in OR successful session restore.

async function startPostAuthFlow(
  context: vscode.ExtensionContext,
  sidebarProvider: SidebarProvider,
  userId: string
): Promise<void> {
  // Fetch initial data
  const [rules, branch] = await Promise.all([
    db.getRules(),
    Promise.resolve(getCurrentBranch() ?? 'main'),
  ])

  sidebarProvider.setRules(rules)
  sidebarProvider.setBranch(branch)

  // Register all features
  registerViolationDetection()
  registerNotifications()
  registerGitIntegration(userId)

  // Register highlighter and collect disposables
  const highlighterDisposables = registerHighlighter()
  context.subscriptions.push(...highlighterDisposables)

  // Start file watcher
  context.subscriptions.push(startFileWatcher())

  // Start git tracker
  const gitDisposables = await startGitTracker()
  context.subscriptions.push(...gitDisposables)

  // Start realtime subscriptions
  realtime.subscribeToRuleUpdates(rule => {
    eventBus.emit('rule:updated', { rule })
    vscode.window.showInformationMessage(`Collar: Rule ${rule.id} was updated`)
  })

  realtime.subscribeToViolationUpdates(violations => {
    eventBus.emit('violation:detected', { violations })
  })

  console.log('[Collar] Ready')
}

// ─── Credential Prompt ────────────────────────────────────────────────────────

async function promptForCredentials(context: vscode.ExtensionContext): Promise<boolean> {
  const url = await vscode.window.showInputBox({
    prompt: 'Enter your Supabase project URL',
    placeHolder: 'https://your-project.supabase.co',
    ignoreFocusOut: true,
  })

  if (!url) return false

  const key = await vscode.window.showInputBox({
    prompt: 'Enter your Supabase anon key',
    placeHolder: 'eyJ...',
    ignoreFocusOut: true,
    password: true,
  })

  if (!key) return false

  await context.secrets.store(SECRET_URL, url)
  await context.secrets.store(SECRET_KEY, key)

  initSupabaseClient(url, key)
  initViolationDetection(url)

  return true
}

// ─── Deactivate ───────────────────────────────────────────────────────────────

export function deactivate() {
  realtime.disconnect()
  disposeHighlighter()
  console.log('[Collar] Deactivated')
}
