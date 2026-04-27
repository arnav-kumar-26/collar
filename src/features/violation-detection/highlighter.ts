import * as vscode from 'vscode'
import { eventBus } from '../../core/eventBus'
import { Violation, Severity } from '../../types'

// ─── Decoration Types ─────────────────────────────────────────────────────────
// One decoration type per severity. Created once, reused on every update.
// Full line background tint — more immediate than squiggly underlines.

const decorations: Record<Severity, vscode.TextEditorDecorationType> = {
  critical: vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(220, 38, 38, 0.15)',    // red tint
    isWholeLine: true,
    gutterIconPath: undefined,                       // can add icon later
    overviewRulerColor: 'rgba(220, 38, 38, 0.8)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  }),
  major: vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(245, 158, 11, 0.15)',   // amber tint
    isWholeLine: true,
    overviewRulerColor: 'rgba(245, 158, 11, 0.8)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  }),
  minor: vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(34, 197, 94, 0.10)',    // green tint
    isWholeLine: true,
    overviewRulerColor: 'rgba(34, 197, 94, 0.6)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  }),
}

// ─── State ────────────────────────────────────────────────────────────────────
// All active violations keyed by file path for fast lookup on editor focus

let violationsByFile = new Map<string, Violation[]>()

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerHighlighter(): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = []

  // Update decorations when violations change
  eventBus.on('violation:detected', ({ violations }) => {
    updateViolations(violations)
  })

  // When analysis completes with zero violations, clear the file's decorations
  eventBus.on('analysis:complete', ({ result, trigger: _trigger }) => {
    if (result.violations.length === 0) {
      // Will be handled via the active editor refresh below
      applyDecorationsToActiveEditor()
    }
  })

  // Re-apply when the developer switches to a different file
  const editorChange = vscode.window.onDidChangeActiveTextEditor(() => {
    applyDecorationsToActiveEditor()
  })
  disposables.push(editorChange)

  // Hover provider — shows rule ID and explanation when hovering a highlighted line
  // { scheme: 'file' } covers all file types regardless of language
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file' },
    {
      provideHover(document, position) {
        const fileViolations = violationsByFile.get(document.uri.fsPath)
        if (!fileViolations) return null

        const lineNumber = position.line + 1  // VS Code is 0-indexed, violations are 1-indexed

        const matching = fileViolations.filter(
          v => lineNumber >= v.line_start && lineNumber <= v.line_end
        )

        if (matching.length === 0) return null

        const contents = matching.map(v => {
          const badge = severityBadge(v.rule_id)
          return new vscode.MarkdownString(`${badge} **${v.rule_id}**\n\n${v.explanation}`)
        })

        return new vscode.Hover(contents)
      }
    }
  )
  disposables.push(hoverProvider)

  return disposables
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

function updateViolations(violations: Violation[]): void {
  // Rebuild the file → violations map
  violationsByFile = new Map()
  for (const v of violations) {
    const existing = violationsByFile.get(v.file_path) ?? []
    violationsByFile.set(v.file_path, [...existing, v])
  }

  applyDecorationsToActiveEditor()
}

function applyDecorationsToActiveEditor(): void {
  const editor = vscode.window.activeTextEditor
  if (!editor) return

  const filePath = editor.document.uri.fsPath
  const fileViolations = violationsByFile.get(filePath) ?? []

  const ranges: Record<Severity, vscode.DecorationOptions[]> = {
    critical: [],
    major: [],
    minor: [],
  }

  for (const v of fileViolations) {
    // VS Code lines are 0-indexed
    const startLine = Math.max(0, v.line_start - 1)
    const endLine = Math.max(0, v.line_end - 1)

    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, Number.MAX_SAFE_INTEGER)
    )

    // We need the severity from the rule — it's stored on the violation object
    // The severity comes from the LLM response which mirrors the rule severity
    const severity = getSeverityForViolation(v)
    ranges[severity].push({ range })
  }

  editor.setDecorations(decorations.critical, ranges.critical)
  editor.setDecorations(decorations.major, ranges.major)
  editor.setDecorations(decorations.minor, ranges.minor)
}

function getSeverityForViolation(v: Violation): Severity {
  // The violation doesn't store severity directly — it comes from the rule.
  // For now we parse it from the rule_id prefix as a fast lookup:
  // BR- = business, AR- = architectural, SC- = security, TS- = test
  // The actual severity is fetched from rules and should be passed through.
  // TODO: store severity on violation record for faster lookup
  return 'major'  // fallback until severity is passed through from the analysis result
}

function severityBadge(ruleId: string): string {
  if (ruleId.startsWith('BR')) return '🔴'
  if (ruleId.startsWith('AR')) return '🟠'
  if (ruleId.startsWith('SC')) return '🔴'
  if (ruleId.startsWith('TS')) return '🟡'
  return '⚠️'
}

export function disposeHighlighter(): void {
  Object.values(decorations).forEach(d => d.dispose())
}
