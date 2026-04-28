import { IRealtime, Unsubscribe } from '../interfaces/IRealtime'
import { getSupabaseClient } from './client'
import { Rule, Violation } from '../../core/models'

// ─── SupabaseRealtime ─────────────────────────────────────────────────────────
// Manages persistent WebSocket subscriptions via Supabase Realtime.
// Not polling — Supabase pushes changes down the open connection instantly.
//
// Migration note: to move to AWS API Gateway WebSocket, replace
// the .channel().on('postgres_changes') calls with ws.onmessage handlers.
// The callback signatures stay the same.

export class SupabaseRealtime implements IRealtime {
  private channels: ReturnType<typeof getSupabaseClient>['channel'][] = []

  subscribeToRuleUpdates(callback: (rule: Rule) => void): Unsubscribe {
    const channel = getSupabaseClient()
      .channel('collar-rule-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rules' },
        (payload) => callback(payload.new as Rule)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rules' },
        (payload) => callback(payload.new as Rule)
      )
      .subscribe()

    this.channels.push(channel as any)

    return () => {
      getSupabaseClient().removeChannel(channel as any)
    }
  }

  subscribeToViolationUpdates(callback: (violations: Violation[]) => void): Unsubscribe {
    // Violations are written in bulk after a teammate commits.
    // We listen for snapshot inserts (one per analysis run) then fetch the violations.
    const channel = getSupabaseClient()
      .channel('collar-violation-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'snapshots' },
        async (payload) => {
          const snapshotId = (payload.new as { id: string }).id

          const { data } = await getSupabaseClient()
            .from('violations')
            .select('*')
            .eq('snapshot_id', snapshotId)
            .eq('status', 'active')

          if (data) callback(data as Violation[])
        }
      )
      .subscribe()

    this.channels.push(channel as any)

    return () => {
      getSupabaseClient().removeChannel(channel as any)
    }
  }

  disconnect(): void {
    this.channels.forEach(channel => {
      getSupabaseClient().removeChannel(channel as any)
    })
    this.channels = []
  }
}

export const realtime: IRealtime = new SupabaseRealtime()
