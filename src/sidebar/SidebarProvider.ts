import * as vscode from 'vscode'
import { eventBus } from '../core/eventBus'
import { ExtensionMessage, WebviewMessage, User, Violation, Rule, ChatHistoryEntry } from '../core/models'

// ─── SidebarProvider ─────────────────────────────────────────────────────────
// Manages the Webview lifecycle.
// Bridges the extension host (TypeScript, Node.js) and the React sidebar (browser sandbox).
// All communication goes through postMessage — there is no shared memory.

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private extensionUri: vscode.Uri
  private pendingMessage: ExtensionMessage | null = null
  private supabaseUrl: string = ''

  sendToWebview(message: ExtensionMessage): void {
  if (this.view) {
    this.view.webview.postMessage(message)
  } else {
    this.pendingMessage = message  // store until view is ready
  }
}

  // State that the sidebar needs on first load
  private state: {
    user: User | null
    violations: Violation[]
    rules: Rule[]
    branch: string
  } = { user: null, violations: [], rules: [], branch: '' }

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri
    this.registerEventBusListeners()
  }

  // Called by VS Code when the sidebar first becomes visible
  resolveWebviewView(webviewView: vscode.WebviewView): void {
  this.view = webviewView

  webviewView.webview.options = {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(this.extensionUri, 'out'),
    ],
  }

  webviewView.webview.html = this.getHtml(webviewView.webview)

  webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
    this.handleWebviewMessage(message)
  })

  // Send any message that was queued before the view was ready
  if (this.pendingMessage) {
    this.view.webview.postMessage(this.pendingMessage)
    this.pendingMessage = null
  }
}

  // ── Inbound (Webview → Extension) ─────────────────────────────────────────

  private handleWebviewMessage(message: WebviewMessage): void {
    switch (message.type) {

      case 'ready':
        if (this.state.user) {
          this.send({
            type: 'init',
            data: {
              user: this.state.user,
              violations: this.state.violations,
              rules: this.state.rules,
              branch: this.state.branch,
            }
          })
        } else {
          // No user — tell the sidebar to show the sign in screen
          this.send({ type: 'notSignedIn' })
        }
        break

      case 'triggerAnalysis':
        vscode.commands.executeCommand('collar.triggerAnalysis')
        break

      case 'signIn':
        vscode.commands.executeCommand('collar.signIn')
        break

      case 'signOut':
        vscode.commands.executeCommand('collar.signOut')
        break

      case 'chatMessage':
        this.handleChatMessage(message.text, message.history)
        break
    }
  }

  // ── Outbound (Extension → Webview) ────────────────────────────────────────

  private async handleChatMessage(text: string, history: ChatHistoryEntry[]): Promise<void> {
    console.log('[Collar] Chat message received:', text)
    try {
      const { getSupabaseClient } = await import('../services/supabase/client')
      const { getCodebaseSummary } = await import('../features/violation-detection')

      const session = await getSupabaseClient().auth.getSession()
      const token = session.data.session?.access_token

      const response = await fetch(`${this.supabaseUrl}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          history,
          context: {
            codebase_summary: getCodebaseSummary(),
            rules: this.state.rules.map(r => ({
              id: r.id,
              name: r.name,
              severity: r.severity,
              description: r.description,
            })),
            violations: this.state.violations.map(v => ({
              rule_id: v.rule_id,
              file_path: v.file_path,
              line_start: v.line_start,
              severity: v.severity,
              explanation: v.explanation,
              code_excerpt: v.code_excerpt,
            })),
          },
          provider: 'groq',
        }),
      })

      if (!response.ok) {
        throw new Error(`Chat Edge Function returned ${response.status}`)
      }

      const data = await response.json() as { response: string }
      this.send({ type: 'chatResponse', data: { text: data.response } })

    } catch (err) {
      console.error('[Collar] Chat failed:', err)
      this.send({ type: 'chatError', data: { error: (err as Error).message } })
    }
  }

  private send(message: ExtensionMessage): void {
    this.view?.webview.postMessage(message)
  }

  // Listen to the event bus and forward relevant events to the webview
  private registerEventBusListeners(): void {

    eventBus.on('violation:detected', ({ violations }) => {
      const incomingFiles = new Set(violations.map(v => v.file_path))
      this.state.violations = [
        ...this.state.violations.filter(v => !incomingFiles.has(v.file_path)),
        ...violations,
      ]
      this.send({ type: 'violationsUpdated', data: this.state.violations })
    })

    eventBus.on('rule:updated', ({ rule }) => {
      this.send({ type: 'ruleUpdated', data: rule })
    })

    eventBus.on('branch:switched', ({ branch }) => {
      this.state.branch = branch
      this.send({ type: 'branchChanged', data: branch })
    })

    eventBus.on('analysis:started', () => {
      this.send({ type: 'analysisStarted' })
    })
  }

  // ── Public setters (called from extension.ts) ─────────────────────────────

  setUser(user: User): void {
  this.state.user = user
  if (this.view) {
    this.send({
      type: 'init',
      data: {
        user: this.state.user,
        violations: this.state.violations,
        rules: this.state.rules,
        branch: this.state.branch,
      }
    })
  }
}

setSupabaseUrl(url: string): void {
  this.supabaseUrl = url
}

  setRules(rules: Rule[]): void {
    this.state.rules = rules
  }

  setBranch(branch: string): void {
    this.state.branch = branch
  }

  // ── HTML Shell ────────────────────────────────────────────────────────────

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'sidebar.js')
    )

    // Content Security Policy — required for VS Code webviews
    const csp = [
      `default-src 'none'`,
      `script-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} https:`,
      `connect-src https:`,
    ].join('; ')

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Collar</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      height: 100vh;
      overflow: hidden;
    }
    #root { height: 100vh; display: flex; flex-direction: column; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`
  }
}
