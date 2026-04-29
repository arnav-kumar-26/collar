import * as vscode from 'vscode'
import { eventBus } from '../../core/eventBus'
import { db } from '../../services/supabase/db'
import { AnalysisPayload, AnalysisResult, LLMViolation, Violation } from '../../core/models'
import { getCurrentBranch, getCurrentCommit } from '../../core/gitTracker'

let supabaseUrl = ''

export function initViolationDetection(url: string): void {
  supabaseUrl = url
}

// ─── Register Listeners ───────────────────────────────────────────────────────

export function registerViolationDetection(): void {

  // Debounced save — analyse but do NOT write to Supabase
  eventBus.on('file:saved', async ({ filePath, contents }) => {
    await runAnalysis({
      file_contents: contents,
      file_path: filePath,
      branch: getCurrentBranch() ?? 'unknown',
      commit_sha: getCurrentCommit() ?? null,
      trigger: 'save',
      provider: 'gemini',
    })
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
        provider: 'gemini',
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
        provider: 'gemini',
      })
    }
  })
}

// ─── Core Analysis ────────────────────────────────────────────────────────────

async function runAnalysis(payload: AnalysisPayload): Promise<void> {
  eventBus.emit('analysis:started', {
    filePath: payload.file_path,
    trigger: payload.trigger,
  })

  try {
    const result = await callEdgeFunction(payload)

    eventBus.emit('analysis:complete', { result, trigger: payload.trigger })

    if (result.violations.length > 0) {
      // Convert LLMViolations to full Violation shape for the rest of the app
      const violations = result.violations.map(v => llmViolationToViolation(v, payload, result.snapshot_id))
      eventBus.emit('violation:detected', { violations })
    }

  } catch (err) {
    console.error('[Collar] Analysis failed:', err)
    vscode.window.showWarningMessage(`Collar: Analysis failed — ${(err as Error).message}`)
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
    status: 'active',
    authored_by: null,
    first_seen_sha: payload.commit_sha ?? '',
    resolved_sha: null,
  }
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
