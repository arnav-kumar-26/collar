import * as vscode from 'vscode'
import { eventBus } from '../../core/eventBus'
import { AnalysisPayload, AnalysisResult, LLMViolation, Violation, BatchAnalysisPayload, LLMProvider, Rule, Severity } from '../../core/models'
import { getCurrentBranch, getCurrentCommit } from '../../core/gitTracker'
import { showOfflineState } from '../notifications'

let supabaseUrl = ''
let codebaseSummary = ''  // ← store the latest codebase summary for context in debounced saves
const scannedFiles = new Set<string>()
const ACTIVE_PROVIDER: LLMProvider = 'groq'  // change this to switch provider
const BATCH_PROVIDER: LLMProvider = 'gemini'   // use a faster provider for the initial batch scan
const AUTOFIX_PROVIDER: LLMProvider = 'openrouter'

export function initViolationDetection(url: string): void {
  supabaseUrl = url
}

let allViolations: Violation[] = []

// Keep this in sync — call it from the violation:detected listener
function updateAllViolations(incoming: Violation[], clearFilePath?: string): void {
  const filesToClear = new Set([
    ...incoming.map(v => v.file_path),
    ...(clearFilePath ? [clearFilePath] : [])
  ])
  allViolations = [
    ...allViolations.filter(v => !filesToClear.has(v.file_path)),
    ...incoming
  ]
}

let rules: Rule[] = []

export function initRules(r: Rule[]): void {
  rules = r
}

// ─── Register Listeners ───────────────────────────────────────────────────────

export function registerViolationDetection(): void {

  eventBus.on('file:manual', async ({ filePath, contents }) => {
  await runAnalysis({
    file_contents: contents,
    file_path: filePath,
    branch: getCurrentBranch() ?? 'unknown',
    commit_sha: getCurrentCommit() ?? null,
    trigger: 'manual',
    provider: ACTIVE_PROVIDER,
  })
})

  // Debounced save — analyse but do NOT write to Supabase
 eventBus.on('file:saved', async ({ filePath, contents }) => {
  await runAnalysis({
    file_contents: contents,
    file_path: filePath,
    branch: getCurrentBranch() ?? 'unknown',
    commit_sha: getCurrentCommit() ?? null,
    trigger: 'save',
    provider: ACTIVE_PROVIDER,
    summary: codebaseSummary,
  })

  scannedFiles.add(filePath)
})

  // Commit — analyse AND write to Supabase
  eventBus.on('commit:made', async ({ sha, branch }) => {
    const files = await getWorkspaceFiles()
    for (const { path, contents } of files) {
      await runAnalysis({
        file_contents: contents,
        file_path: path,
        branch,
        commit_sha: sha,
        trigger: 'commit',
        provider: ACTIVE_PROVIDER,
      })
    }
  })

  // Rule update re-analysis — analyse AND write to Supabase
  eventBus.on('rule:updated', async () => {
    const files = await getWorkspaceFiles()
    const branch = getCurrentBranch() ?? 'unknown'
    const sha = getCurrentCommit() ?? null
    for (const { path, contents } of files) {
      await runAnalysis({
        file_contents: contents,
        file_path: path,
        branch,
        commit_sha: sha,
        trigger: 'rule_update',
        provider: ACTIVE_PROVIDER,
      })
    }
  })
}

// ─── Core Analysis ────────────────────────────────────────────────────────────

export async function runInitialScan(): Promise<void> {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    console.log('[Collar] No workspace folder open — cannot run analysis')
    vscode.window.showErrorMessage(
      'Collar requires a folder to be open. Please open your project folder to enable analysis.',
      'Open Folder'
    ).then(selection => {
      if (selection === 'Open Folder') {
        vscode.commands.executeCommand('vscode.openFolder')
      }
    })
    eventBus.emit('analysis:complete', { result: { violations: [], snapshot_id: null }, trigger: 'save' })
    return
  }

  const files = await getWorkspaceFiles()
  const branch = getCurrentBranch() ?? 'unknown'
  const sha = getCurrentCommit() ?? null

  console.log(`[Collar] Scanning ${files.length} files...`)
  eventBus.emit('analysis:started', { filePath: 'workspace', trigger: 'save' })

  try {
    const result = await callBatchEdgeFunction({
      files: files.map(f => ({ path: f.path, contents: f.contents })),
      branch,
      commit_sha: sha,
      trigger: 'save',
      provider: BATCH_PROVIDER,
    })

    files.forEach(f => scannedFiles.add(f.path))
    codebaseSummary = result.summary

    updateAllViolations(result.violations)
    await writeViolationsFile(allViolations)

    if (result.violations.length > 0) {
      eventBus.emit('violation:detected', { violations: result.violations })
    }

    console.log('[Collar] Violation file paths from LLM:',
      result.violations?.map(v => v.file_path))

  } catch (err) {
    const message = (err as Error).message
    if (message.includes('fetch failed') || message.includes('Connect Timeout') || message.includes('network')) {
      vscode.window.showErrorMessage('Collar: No internet connection — analysis skipped. Check your network and try again.')
      showOfflineState()
    } else {
      console.error('[Collar] Initial scan failed:', err)
    }
  }

  eventBus.emit('analysis:complete', {
    result: { violations: [], snapshot_id: null },
    trigger: 'save'
  })

  console.log('[Collar] Initial scan complete.')
}

async function runAnalysis(payload: AnalysisPayload): Promise<void> {
  eventBus.emit('analysis:started', {
    filePath: payload.file_path,
    trigger: payload.trigger,
  })

  try {
    const result = await callEdgeFunction(payload)

    eventBus.emit('analysis:complete', { result, trigger: payload.trigger })

    // Always update — even zero violations clears that file's previous results
    const violations = result.violations.map(v =>
      llmViolationToViolation(v, payload, result.snapshot_id)
    )
    updateAllViolations(violations, payload.file_path)
    await writeViolationsFile(allViolations)

    if (violations.length > 0) {
      eventBus.emit('violation:detected', { violations })
    }

  } catch (err) {
    const message = (err as Error).message
    if (message.includes('fetch failed') || message.includes('Connect Timeout') || message.includes('network')) {
      eventBus.emit('analysis:complete', { result: { violations: [], snapshot_id: null }, trigger: payload.trigger })
    } else {
      console.error('[Collar] Analysis failed:', err)
      vscode.window.showWarningMessage(`Collar: Analysis failed — ${message}`)
      // Always clear the spinner regardless of error type
      eventBus.emit('analysis:complete', { result: { violations: [], snapshot_id: null }, trigger: payload.trigger })
    }
  }
}

// ─── Edge Function Call ───────────────────────────────────────────────────────

async function callEdgeFunction(payload: AnalysisPayload): Promise<AnalysisResult> {
  const url = `${supabaseUrl}/functions/v1/analyse`

  const { getSupabaseClient } = await import('../../services/supabase/client')
  const session = await getSupabaseClient().auth.getSession()
  const token = session.data.session?.access_token

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Edge Function returned ${response.status}`)
  }

  return response.json()
}

async function callBatchEdgeFunction(payload: BatchAnalysisPayload): Promise<{ violations: Violation[]; summary: string }> {
  const url = `${supabaseUrl}/functions/v1/analyse-batch`

  const { getSupabaseClient } = await import('../../services/supabase/client')
  const session = await getSupabaseClient().auth.getSession()
  const token = session.data.session?.access_token

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Batch Edge Function returned ${response.status}`)
  }

  const data = await response.json()

  // Convert LLM violations to full Violation shape
  const violations: Violation[] = (data.violations ?? []).map((v: LLMViolation) => ({
    id: '',
    snapshot_id: '',
    rule_id: v.rule_id,
    file_path: (v.file_path ?? '').replace(/\\\\/g, '\\'), // Handle Windows paths
    line_start: v.line_start,
    line_end: v.line_end,
    code_excerpt: v.code_excerpt,
    explanation: v.explanation,
    severity: getSeverityForRule(v.rule_id),
    status: 'active' as const,
    authored_by: null,
    first_seen_sha: payload.commit_sha ?? '',
    resolved_sha: null,
  }))

  return { violations, summary: data.summary ?? '' }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function llmViolationToViolation(
  v: LLMViolation,
  payload: AnalysisPayload,
  snapshotId: string | null
): Violation {
  return {
    id: '',                        // filled by Supabase on write
    snapshot_id: snapshotId ?? '',
    rule_id: v.rule_id,
    file_path: payload.file_path,
    line_start: v.line_start,
    line_end: v.line_end,
    code_excerpt: v.code_excerpt,
    explanation: v.explanation,
    severity: getSeverityForRule(v.rule_id),
    status: 'active',
    authored_by: null,
    first_seen_sha: payload.commit_sha ?? '',
    resolved_sha: null,
  }
}

function getSeverityForRule(ruleId: string): Severity {
  return rules.find(r => r.id === ruleId)?.severity ?? 'major'
}

// ─── Violations File ──────────────────────────────────────────────────────────

async function writeViolationsFile(violations: Violation[]): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) return

  const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'violations.md')

  if (violations.length === 0) {
    try { await vscode.workspace.fs.delete(uri) } catch {}
    return
  }

  const byFile = new Map<string, Violation[]>()
  for (const v of violations) {
    if (!byFile.has(v.file_path)) byFile.set(v.file_path, [])
    byFile.get(v.file_path)!.push(v)
  }

  const lines: string[] = [
    '# Collar Violations',
    `Last updated: ${new Date().toLocaleString()}`,
    '',
  ]

  for (const [filePath, vs] of byFile) {
    lines.push(`## ${vscode.workspace.asRelativePath(filePath)}`, '')
    for (const v of vs) {
      lines.push(
        `**${v.rule_id}** (${v.severity}) — Line ${v.line_start}`,
        v.explanation,
        '```',
        v.code_excerpt,
        '```',
        '',
      )
    }
    lines.push('---', '')
  }

  await vscode.workspace.fs.writeFile(
    uri,
    Buffer.from(lines.join('\n'), 'utf8')
  )
}

// ─── Auto Fix ─────────────────────────────────────────────────────────────────

export async function runAutoFix(): Promise<void> {
  if (allViolations.length === 0) {
    vscode.window.showInformationMessage('Collar: No violations to fix.')
    return
  }

  // ── Git safety check ──────────────────────────────────────────────────────
  const gitExtension = vscode.extensions.getExtension('vscode.git')
  if (gitExtension) {
    const git = gitExtension.exports.getAPI(1)
    const repo = git.repositories[0]
    if (repo) {
      const hasChanges =
        repo.state.workingTreeChanges.length > 0 ||
        repo.state.indexChanges.length > 0

      if (hasChanges) {
        const choice = await vscode.window.showWarningMessage(
          'Collar: You have uncommitted changes. Commit or stash first so you can revert if fixes are wrong.',
          'Continue anyway',
          'Cancel'
        )
        if (choice !== 'Continue anyway') return
      }
    }
  }

  // ── Group by file ─────────────────────────────────────────────────────────
  const byFile = new Map<string, Violation[]>()
  for (const v of allViolations) {
    if (!byFile.has(v.file_path)) byFile.set(v.file_path, [])
    byFile.get(v.file_path)!.push(v)
  }

  vscode.window.showInformationMessage(
    `Collar: Auto-fixing violations across ${byFile.size} file(s)...`
  )

  const { getSupabaseClient } = await import('../../services/supabase/client')
  const session = await getSupabaseClient().auth.getSession()
  const token = session.data.session?.access_token

  let fixedCount = 0
  let skippedCount = 0

  for (const [filePath, fileViolations] of byFile) {
    try {
      const doc = await vscode.workspace.openTextDocument(filePath)
      const fileContents = doc.getText()

      const response = await fetch(
        `${supabaseUrl}/functions/v1/autofix`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            file_path: vscode.workspace.asRelativePath(filePath),
            file_contents: fileContents,
            violations: fileViolations.map(v => ({
              rule_id: v.rule_id,
              code_excerpt: v.code_excerpt,
              explanation: v.explanation,
              severity: v.severity,
            })),
            provider: AUTOFIX_PROVIDER,
          }),
        }
      )

      if (!response.ok) {
        console.error(`[Collar] Autofix returned ${response.status} for ${filePath}`)
        continue
      }

      const { fixes } = await response.json() as {
        fixes: { original: string; replacement: string }[]
      }

      if (!fixes?.length) continue

      let updatedContents = fileContents

      for (const fix of fixes) {
        if (!updatedContents.includes(fix.original)) {
          console.warn(`[Collar] Could not match block in ${filePath} — skipping: ${fix.original.substring(0, 60)}`)
          skippedCount++
          continue
        }
        updatedContents = updatedContents.replace(fix.original, fix.replacement)
        fixedCount++
      }

      if (updatedContents !== fileContents) {
        const edit = new vscode.WorkspaceEdit()
        const fullRange = new vscode.Range(
          doc.lineAt(0).range.start,
          doc.lineAt(doc.lineCount - 1).range.end
        )
        edit.replace(doc.uri, fullRange, updatedContents)
        await vscode.workspace.applyEdit(edit)
        await doc.save()
      }

    } catch (err) {
      console.error(`[Collar] Autofix failed for ${filePath}:`, err)
    }
  }

  const msg = [`Collar: Auto-fix complete. ${fixedCount} fix(es) applied.`]
  if (skippedCount > 0) msg.push(`${skippedCount} could not be matched and were skipped.`)
  vscode.window.showInformationMessage(msg.join(' '))
}

async function getWorkspaceFiles(): Promise<{ path: string; contents: string }[]> {
  const uris = await vscode.workspace.findFiles(
    '**/*',
    '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.git/**,**/coverage/**}'
  )

  const results: { path: string; contents: string }[] = []

  for (const uri of uris) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri)
      results.push({ path: uri.fsPath, contents: doc.getText() })
    } catch {
      // Binary files or unreadable files — skip
    }
  }

  return results
}
