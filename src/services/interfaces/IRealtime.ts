import { Rule, Violation } from '../../types'

// ─── IRealtime ───────────────────────────────────────────────────────────────
// WebSocket subscription management.
// On Supabase: uses postgres_changes subscriptions.
// On AWS: uses API Gateway WebSocket or similar — same interface, different wire.

export type Unsubscribe = () => void

export interface IRealtime {
  // Fires when an admin updates a rule — all connected plugins refresh
  subscribeToRuleUpdates(callback: (rule: Rule) => void): Unsubscribe

  // Fires when a teammate commits and new violations are written — silent update
  subscribeToViolationUpdates(callback: (violations: Violation[]) => void): Unsubscribe

  // Cleanly closes all open WebSocket connections
  disconnect(): void
}
