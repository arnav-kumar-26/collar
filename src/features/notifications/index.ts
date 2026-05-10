import * as vscode from 'vscode'
import { eventBus } from '../../core/eventBus'
import { Violation } from '../../core/models'

// ─── Status Bar ───────────────────────────────────────────────────────────────

let statusBarItem: vscode.StatusBarItem
let allViolations: Violation[] = []

export function initStatusBar(): vscode.Disposable {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  )
  statusBarItem.command = 'collar.triggerAnalysis'
  statusBarItem.text = '$(shield) Collar'
  statusBarItem.tooltip = 'Click to run Collar analysis'
  statusBarItem.show()

  const autoFixButton = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right, 98
  )
  autoFixButton.text = '$(sparkle) Auto-fix'
  autoFixButton.tooltip = 'Auto-fix all violations using Collar'
  autoFixButton.command = 'collar.autoFix'
  autoFixButton.show()

  return vscode.Disposable.from(statusBarItem, autoFixButton)
}

// ─── Register All Notification Surfaces ──────────────────────────────────────

export function registerNotifications(): void {

  // Update all surfaces on every analysis result
  eventBus.on('analysis:complete', ({ result, trigger }) => {
    // Status bar always updates — even debounced saves
    updateStatusBar([])
  })

  eventBus.on('violation:detected', ({ violations }) => {

    const incomingFiles = new Set(violations.map(v => v.file_path))
    allViolations = [
    ...allViolations.filter(v => !incomingFiles.has(v.file_path)),
    ...violations,
  ]

    console.log(`[Collar] Total violations: ${allViolations.length}`)
    allViolations.forEach(v => {
      console.log(`  [${v.rule_id}] ${v.file_path}:${v.line_start} — ${v.explanation.slice(0, 60)}...`)
    })

    updateStatusBar(allViolations)

    // Popups only for critical violations, and only on commit or manual trigger
    const criticals = allViolations.filter(isCritical)
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

export function showOfflineState(): void {
  statusBarItem.text = '$(cloud-offline) Collar: Offline'
  statusBarItem.backgroundColor = undefined
  statusBarItem.tooltip = 'No internet connection — analysis unavailable'
}

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

function isCritical(v: Violation): boolean { return v.severity === 'critical' }
function isMajor(v: Violation): boolean { return v.severity === 'major' }
function isMinor(v: Violation): boolean { return v.severity === 'minor' }