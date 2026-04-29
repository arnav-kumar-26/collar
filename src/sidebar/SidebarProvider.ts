import * as vscode from 'vscode'
import * as path from 'path'
import { eventBus } from '../core/eventBus'
import { ExtensionMessage, WebviewMessage, User, Violation, Rule } from '../core/models'

// ─── SidebarProvider ─────────────────────────────────────────────────────────
// Manages the Webview lifecycle.
// Bridges the extension host (TypeScript, Node.js) and the React sidebar (browser sandbox).
// All communication goes through postMessage — there is no shared memory.

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private extensionUri: vscode.Uri

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

    // Listen to messages from the React sidebar
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this.handleWebviewMessage(message)
    })
  }

  // ── Inbound (Webview → Extension) ─────────────────────────────────────────

  private handleWebviewMessage(message: WebviewMessage): void {
    switch (message.type) {

      case 'ready':
        // Webview has loaded and is ready to receive data
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
        // Handled by the chat feature (future: route through event bus)
        console.log('[Collar] Chat message received:', message.text)
        break
    }
  }

  // ── Outbound (Extension → Webview) ────────────────────────────────────────

  private send(message: ExtensionMessage): void {
    this.view?.webview.postMessage(message)
  }

  // Listen to the event bus and forward relevant events to the webview
  private registerEventBusListeners(): void {

    eventBus.on('violation:detected', ({ violations }) => {
      this.state.violations = violations
      this.send({ type: 'violationsUpdated', data: violations })
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
