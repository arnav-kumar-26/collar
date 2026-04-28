import { IDatabase } from '../interfaces/IDatabase'
import { getSupabaseClient } from './client'
import { Rule, Violation, Snapshot, Commit, Branch } from '../../core/models'

// ─── SupabaseDatabase ────────────────────────────────────────────────────────
// Concrete implementation of IDatabase backed by Supabase + PostgREST.
//
// Migration note: to move to AWS, implement IDatabase with Lambda calls instead.
// The interface contract (method names, parameters, return types) stays identical.
// Features never need to change.

export class SupabaseDatabase implements IDatabase {

  // ── Rules ──────────────────────────────────────────────────────────────────

  async getRules(): Promise<Rule[]> {
    const { data, error } = await getSupabaseClient()
      .from('rules')
      .select('*')
      .eq('status', 'active')
      .order('category')

    if (error) throw new Error(`getRules failed: ${error.message}`)
    return data as Rule[]
  }

  // ── Violations ─────────────────────────────────────────────────────────────

  async getViolations(branch: string): Promise<Violation[]> {
    // Get the latest snapshot for this branch, then fetch its violations
    const { data: snapshot, error: snapshotError } = await getSupabaseClient()
      .from('snapshots')
      .select('id, commits!inner(branch)')
      .eq('commits.branch', branch)
      .eq('violations.status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (snapshotError || !snapshot) return []

    const { data, error } = await getSupabaseClient()
      .from('violations')
      .select('*, rules(name, severity)')
      .eq('snapshot_id', snapshot.id)
      .eq('status', 'active')

    if (error) throw new Error(`getViolations failed: ${error.message}`)
    return data as Violation[]
  }

  async writeViolations(violations: Omit<Violation, 'id'>[]): Promise<void> {
    if (violations.length === 0) return

    const { error } = await getSupabaseClient()
      .from('violations')
      .insert(violations)

    if (error) throw new Error(`writeViolations failed: ${error.message}`)
  }

  async resolveViolations(resolvedSha: string, filePaths: string[]): Promise<void> {
    const { error } = await getSupabaseClient()
      .from('violations')
      .update({ status: 'resolved', resolved_sha: resolvedSha })
      .in('file_path', filePaths)
      .eq('status', 'active')

    if (error) throw new Error(`resolveViolations failed: ${error.message}`)
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  async writeSnapshot(snapshot: Omit<Snapshot, 'id' | 'created_at'>): Promise<Snapshot> {
    const { data, error } = await getSupabaseClient()
      .from('snapshots')
      .insert(snapshot)
      .select()
      .single()

    if (error) throw new Error(`writeSnapshot failed: ${error.message}`)
    return data as Snapshot
  }

  // ── Commits ────────────────────────────────────────────────────────────────

  async writeCommit(commit: Omit<Commit, 'id'>): Promise<Commit> {
    const { data, error } = await getSupabaseClient()
      .from('commits')
      .upsert(commit, { onConflict: 'sha' })
      .select()
      .single()

    if (error) throw new Error(`writeCommit failed: ${error.message}`)
    return data as Commit
  }

  async getCommitHistory(branch: string, limit = 50): Promise<Commit[]> {
    const { data, error } = await getSupabaseClient()
      .from('commits')
      .select('*')
      .eq('branch', branch)
      .order('committed_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`getCommitHistory failed: ${error.message}`)
    return data as Commit[]
  }

  // ── Branches ───────────────────────────────────────────────────────────────

  async upsertBranch(branch: Omit<Branch, 'id' | 'created_at'>): Promise<void> {
    const { error } = await getSupabaseClient()
      .from('branches')
      .upsert(branch, { onConflict: 'name' })

    if (error) throw new Error(`upsertBranch failed: ${error.message}`)
  }

  async getBranch(name: string): Promise<Branch | null> {
    const { data, error } = await getSupabaseClient()
      .from('branches')
      .select('*')
      .eq('name', name)
      .single()

    if (error) return null
    return data as Branch
  }
}

// Export a singleton instance
export const db: IDatabase = new SupabaseDatabase()
