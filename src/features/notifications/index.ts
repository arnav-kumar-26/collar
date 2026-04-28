import * as vscode from 'vscode'
import { eventBus } from '../../core/eventBus'
import { Violation } from '../../core/models'

// ─── Status Bar ───────────────────────────────────────────────────────────────

let statusBarItem: vscode.StatusBarItem

export function initStatusBar(): vscode.Disposable {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  )
  statusBarItem.command = 'collar.triggerAnalysis'
  statusBarItem.text = '$(shield) Collar'
  statusBarItem.tooltip = 'Click to run Collar analysis'
  statusBarItem.show()

  return statusBarItem
}

// ─── Diagnostics (Problems Panel) ─────────────────────────────────────────────

const diagnosticCollection = vscode.languages.createDiagnosticCollection('collar')

// ─── Register All Notification Surfaces ──────────────────────────────────────

export function registerNotifications(): void {

  // Update all surfaces on every analysis result
  eventBus.on('analysis:complete', ({ result, trigger }) => {
    const allViolations: Violation[] = []  // will be populated via violation:detected
    // Status bar always updates — even debounced saves
    updateStatusBar([])
  })

  eventBus.on('violation:detected', ({ violations }) => {
    updateStatusBar(violations)
    updateProblemsPanel(violations)

    // Popups only for critical violations, and only on commit or manual trigger
    const criticals = violations.filter(v => v.rule_id.startsWith('SC') || isCritical(v))
    if (criticals.length > 0) {
      showCriticalPopup(criticals)
    }
  })

  // Spinner while analysis runs
  eventBus.on('analysis:started', () => {
    statusBarItem.text = '$(loading~spin) Collar: Analysing...'
  })
}

// ─── Status Bar Updates ───────────────────────────────────────────────────────

function updateStatusBar(violations: Violation[]): void {
  const critical = violations.filter(isCritical).length
  const major = violations.filter(isMajor).length
  const minor = violations.filter(isMinor).length

  if (violations.length === 0) {
    statusBarItem.text = '$(shield) Collar: Clean'
    statusBarItem.backgroundColor = undefined
    return
  }

  // Flash red if there are criticals
  if (critical > 0) {
    statusBarItem.text = `$(error) ${critical} critical`
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')

    // Flash and then revert to normal colouring after 3s
    setTimeout(() => {
      statusBarItem.backgroundColor = undefined
      statusBarItem.text = buildStatusText(critical, major, minor)
    }, 3000)
  } else {
    statusBarItem.text = buildStatusText(critical, major, minor)
    statusBarItem.backgroundColor = undefined
  }
}

function buildStatusText(critical: number, major: number, minor: number): string {
  const parts: string[] = []
  if (critical > 0) parts.push(`$(error) ${critical}`)
  if (major > 0) parts.push(`$(warning) ${major}`)
  if (minor > 0) parts.push(`$(info) ${minor}`)
  return `$(shield) ${parts.join('  ')}`
}

// ─── Problems Panel ───────────────────────────────────────────────────────────

function updateProblemsPanel(violations: Violation[]): void {
  diagnosticCollection.clear()

  // Group by file
  const byFile = new Map<string, Violation[]>()
  for (const v of violations) {
    byFile.set(v.file_path, [...(byFile.get(v.file_path) ?? []), v])
  }

  byFile.forEach((fileViolations, filePath) => {
    const uri = vscode.Uri.file(filePath)
    const diagnostics = fileViolations.map(v => {
      const range = new vscode.Range(
        new vscode.Position(Math.max(0, v.line_start - 1), 0),
        new vscode.Position(Math.max(0, v.line_end - 1), Number.MAX_SAFE_INTEGER)
      )

      const diagnostic = new vscode.Diagnostic(
        range,
        `[${v.rule_id}] ${v.explanation}`,
        toDiagnosticSeverity(v)
      )
      diagnostic.source = 'Collar'
      diagnostic.code = v.rule_id
      return diagnostic
    })

    diagnosticCollection.set(uri, diagnostics)
  })
}

// ─── Critical Popup ───────────────────────────────────────────────────────────

function showCriticalPopup(violations: Violation[]): void {
  const count = violations.length
  const label = count === 1
    ? `1 critical violation detected`
    : `${count} critical violations detected`

  vscode.window.showErrorMessage(label, 'View in Collar').then(selection => {
    if (selection === 'View in Collar') {
      vscode.commands.executeCommand('collar.sidebar.focus')
    }
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isCritical(v: Violation): boolean {
  // TODO: derive from rule severity once passed through
  return false
}
function isMajor(v: Violation): boolean { return true }
function isMinor(v: Violation): boolean { return false }

function toDiagnosticSeverity(v: Violation): vscode.DiagnosticSeverity {
  // TODO: derive from rule severity
  return vscode.DiagnosticSeverity.Warning
}
