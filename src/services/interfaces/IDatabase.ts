import { Rule, Violation, Snapshot, Commit, Branch } from '../../core/models'

// ─── IDatabase ───────────────────────────────────────────────────────────────
// Every method a feature can call against the data layer.
// Features import this interface, never the concrete implementation.
// Swap the implementation in db.ts to migrate to AWS — nothing else changes.

export interface IDatabase {
  // Rules
  getRules(): Promise<Rule[]>

  // Violations
  getViolations(branch: string): Promise<Violation[]>
  writeViolations(violations: Omit<Violation, 'id'>[]): Promise<void>
  resolveViolations(resolvedSha: string, filePaths: string[]): Promise<void>

  // Snapshots
  writeSnapshot(snapshot: Omit<Snapshot, 'id' | 'created_at'>): Promise<Snapshot>

  // Commits
  writeCommit(commit: Omit<Commit, 'id'>): Promise<Commit>
  getCommitHistory(branch: string, limit?: number): Promise<Commit[]>

  // Branches
  upsertBranch(branch: Omit<Branch, 'id' | 'created_at'>): Promise<void>
  getBranch(name: string): Promise<Branch | null>
}
