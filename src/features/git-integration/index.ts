import { eventBus } from '../../core/eventBus'
import { db } from '../../services/supabase/db'
import { Violation } from '../../core/models'

// ─── Git Integration ──────────────────────────────────────────────────────────
// Listens to branch and commit events from the git tracker.
// On branch switch: restores the last committed violation state for that branch.
// On commit: records the commit in the DB so the history tab can display it.

export function registerGitIntegration(currentUserId: string): void {

  // When the developer switches branch, restore that branch's violation state
  eventBus.on('branch:switched', async ({ branch }) => {
    try {
      const violations = await db.getViolations(branch)

      // Emit as if an analysis just completed — all listeners update themselves
      if (violations.length > 0) {
        eventBus.emit('violation:detected', { violations })
      }

      // Ensure the branch is tracked in the DB
      await db.upsertBranch({
        name: branch,
        created_by: currentUserId,
        fork_commit_sha: null,
        forked_from: null,
        status: 'active',
      })
    } catch (err) {
      console.error('[Collar] Failed to restore branch state:', err)
    }
  })

  // When a commit is made, record it in the DB for history tracking
  eventBus.on('commit:made', async ({ sha, branch, message }) => {
    try {
      await db.writeCommit({
        sha,
        branch,
        author_id: currentUserId,
        committed_at: new Date().toISOString(),
        parent_sha: null,  // TODO: get from git tracker
        message,
      })
    } catch (err) {
      console.error('[Collar] Failed to write commit record:', err)
    }
  })
}
