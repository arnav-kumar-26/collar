import * as vscode from 'vscode'
import { eventBus } from './eventBus'

// Directories excluded from analysis
const EXCLUDED = ['node_modules', 'dist', 'out', 'build', '.git', 'coverage']

function isExcluded(filePath: string): boolean {
  return EXCLUDED.some(dir => filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`))
}

// ─── Debounce ─────────────────────────────────────────────────────────────────
// Each file gets its own debounce timer.
// Saving file A then file B doesn't reset file A's timer.

const timers = new Map<string, NodeJS.Timeout>()
const DEBOUNCE_MS = 3000

function debounce(filePath: string, fn: () => void): void {
  const existing = timers.get(filePath)
  if (existing) clearTimeout(existing)
  timers.set(filePath, setTimeout(() => {
    timers.delete(filePath)
    fn()
  }, DEBOUNCE_MS))
}

// ─── File Watcher ─────────────────────────────────────────────────────────────

export function startFileWatcher(): vscode.Disposable {
  // { scheme: 'file' } covers ALL file types — TypeScript, Python, YAML, Dockerfile, .env
  // This is intentional: Collar validates the entire codebase, not just source files
  const watcher = vscode.workspace.onDidSaveTextDocument(document => {
    const filePath = document.uri.fsPath

    if (isExcluded(filePath)) return

    const contents = document.getText()

    debounce(filePath, () => {
      eventBus.emit('file:saved', { filePath, contents })
    })
  })

  return watcher
}
