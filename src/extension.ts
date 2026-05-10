import * as vscode from 'vscode'
import { initSupabaseClient } from './services/supabase/client'
import { startFileWatcher } from './core/fileWatcher'
import { startGitTracker, getCurrentBranch } from './core/gitTracker'
import { registerViolationDetection, initViolationDetection, runInitialScan, runAutoFix, initRules } from './features/violation-detection/index'
import { registerHighlighter, disposeHighlighter } from './features/violation-detection/highlighter'
import { registerNotifications, initStatusBar } from './features/notifications/index'
import { registerGitIntegration } from './features/git-integration/index'
import { SidebarProvider } from './sidebar/SidebarProvider'
import { auth } from './services/supabase/auth'
import { db } from './services/supabase/db'
import { realtime } from './services/supabase/realtime'
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
          sidebarProvider.sendToWebview({ type: 'authDenied' })
          vscode.window.showErrorMessage(
            'Collar: Access denied. Ask your admin to add your GitHub email to the invitation list.'
          )
          return
        }

        await startPostAuthFlow(context, sidebarProvider, user.id)
        sidebarProvider.setUser(user)
        sidebarProvider.sendToWebview({ type: 'authSuccess', data: user })      }
    })
  )

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('collar.signIn', async () => {
    const url = await context.secrets.get(SECRET_URL)
    const key = await context.secrets.get(SECRET_KEY)

    if (!url || !key) {
      const success = await promptForCredentials(context, sidebarProvider)
      if (!success) return    // ← stop here if user cancelled
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

      eventBus.emit('file:manual', {
        filePath: editor.document.uri.fsPath,
        contents: editor.document.getText(),
      })
  })
  )

    context.subscriptions.push(
    vscode.commands.registerCommand('collar.autoFix', async () => {
      await runAutoFix()
    })
    )

  context.subscriptions.push(
  vscode.commands.registerCommand('collar.clearCredentials', async () => {
    await context.secrets.delete('collar.supabaseUrl')
    await context.secrets.delete('collar.supabaseAnonKey')
    await context.secrets.delete('collar.supabaseJWT')
    await context.secrets.delete('collar.supabaseRefreshToken')
    vscode.window.showInformationMessage('Collar: Credentials cleared')
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

  console.log('[Collar] URL found:', !!url)      // ← add
  console.log('[Collar] Key found:', !!key)    

  if (!url || !key) {
    // First launch — no credentials at all
    // The sidebar will show the sign-in screen (handled by the React app)
    console.log('[Collar] No credentials — waiting for sign in')
    sidebarProvider.sendToWebview({ type: 'notSignedIn' })
    return
  }

  // Credentials exist — boot the Supabase client
  initSupabaseClient(url, key)
  initViolationDetection(url)
  sidebarProvider.setSupabaseUrl(url)

  // Try to restore the previous session
  const user = await auth.restoreSession(context.secrets)
  console.log('[Collar] Session restored:', !!user)

  if (!user) {
    console.log('[Collar] No session — prompting sign in')
    sidebarProvider.sendToWebview({ type: 'notSignedIn' })
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
    Promise.resolve(getCurrentBranch() ?? 'none'),
  ])

    sidebarProvider.setRules(rules)
    sidebarProvider.setBranch(branch)
    initRules(rules)

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
  realtime.subscribeToRuleUpdates(async rule => {
    // Refresh the full rules list from Supabase so severity lookups stay accurate
    const updatedRules = await db.getRules()
    initRules(updatedRules)
    sidebarProvider.setRules(updatedRules)
    eventBus.emit('rule:updated', { rule })
    vscode.window.showInformationMessage(`Collar: Rule ${rule.id} was updated`)
  })

  realtime.subscribeToViolationUpdates(violations => {
    eventBus.emit('violation:detected', { violations })
  })

  console.log('[Collar] Starting initial workspace scan...')
  await runInitialScan()

  console.log('[Collar] Ready')
}

// ─── Credential Prompt ────────────────────────────────────────────────────────

async function promptForCredentials(context: vscode.ExtensionContext, sidebarProvider: SidebarProvider): Promise<boolean> {
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
  sidebarProvider.setSupabaseUrl(url)

  return true
}

// ─── Deactivate ───────────────────────────────────────────────────────────────

export function deactivate() {
  realtime.disconnect()
  disposeHighlighter()
  console.log('[Collar] Deactivated')
}
