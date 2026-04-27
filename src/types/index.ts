// ─── Primitives ──────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'major' | 'minor'
export type RuleCategory = 'business' | 'architectural' | 'security' | 'test'
export type ViolationStatus = 'active' | 'resolved' | 'suppressed'
export type SnapshotTrigger = 'commit' | 'rule_update' | 'manual'
export type UserRole = 'admin' | 'author' | 'developer'
export type BranchStatus = 'active' | 'merged' | 'deleted'

// ─── Domain Models ───────────────────────────────────────────────────────────

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
}

export interface Rule {
  id: string               // e.g. "BR-014"
  category: RuleCategory
  name: string
  description: string
  severity: Severity
  status: 'active' | 'archived'
  created_by: string
}

export interface Violation {
  id: string
  snapshot_id: string
  rule_id: string
  file_path: string
  line_start: number
  line_end: number
  code_excerpt: string
  explanation: string
  status: ViolationStatus
  authored_by: string | null
  first_seen_sha: string
  resolved_sha: string | null
}

export interface Snapshot {
  id: string
  commit_id: string | null
  trigger: SnapshotTrigger
  total: number
  critical: number
  major: number
  minor: number
  created_at: string
}

export interface Commit {
  id: string
  sha: string
  branch: string
  author_id: string
  committed_at: string
  parent_sha: string | null
  message: string | null
}

export interface Branch {
  id: string
  name: string
  created_by: string
  created_at: string
  fork_commit_sha: string | null
  forked_from: string | null
  status: BranchStatus
}

// ─── Analysis ────────────────────────────────────────────────────────────────

// Shape the Edge Function returns
export interface AnalysisResult {
  violations: LLMViolation[]
  snapshot_id: string | null   // null on debounced save (not written to DB)
}

// Shape the LLM returns inside the Edge Function
export interface LLMViolation {
  rule_id: string
  line_start: number
  line_end: number
  code_excerpt: string
  explanation: string
  severity: Severity
}

// What the plugin sends to the Edge Function
export interface AnalysisPayload {
  file_contents: string
  file_path: string
  branch: string
  commit_sha: string | null
  trigger: SnapshotTrigger | 'save'   // save = debounced, not written to DB
}

// ─── Webview Messaging ───────────────────────────────────────────────────────

// Extension → Webview
export type ExtensionMessage =
  | { type: 'init'; data: { user: User; violations: Violation[]; rules: Rule[]; branch: string } }
  | { type: 'violationsUpdated'; data: Violation[] }
  | { type: 'ruleUpdated'; data: Rule }
  | { type: 'branchChanged'; data: string }
  | { type: 'analysisStarted' }
  | { type: 'authDenied' }
  | { type: 'authSuccess'; data: User }

// Webview → Extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'chatMessage'; text: string; context?: { file: string; line: number } }
  | { type: 'triggerAnalysis' }
  | { type: 'signIn' }
  | { type: 'signOut' }
