import { AnalysisResult, Rule, Violation } from './models'

// ─── Event Map ───────────────────────────────────────────────────────────────
// All events and their payloads defined here.
// Adding a new event only requires adding a line here — nothing else changes.

export interface CollarEvents {
  'file:saved':         { filePath: string; contents: string }
  'analysis:started':   { filePath: string; trigger: string }
  'analysis:complete':  { result: AnalysisResult; trigger: string }
  'violation:detected': { violations: Violation[] }
  'branch:switched':    { branch: string }
  'commit:made':        { sha: string; branch: string; message: string }
  'rule:updated':       { rule: Rule }
}

type EventKey = keyof CollarEvents
type Listener<K extends EventKey> = (data: CollarEvents[K]) => void

// ─── EventBus ────────────────────────────────────────────────────────────────

class EventBus {
  private listeners: { [K in EventKey]?: Listener<K>[] } = {}

  on<K extends EventKey>(event: K, listener: Listener<K>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    (this.listeners[event] as Listener<K>[]).push(listener)

    // Return an unsubscribe function
    return () => this.off(event, listener)
  }

  off<K extends EventKey>(event: K, listener: Listener<K>): void {
    const eventListeners = this.listeners[event] as Listener<K>[] | undefined
    if (!eventListeners) return
    this.listeners[event] = eventListeners.filter(l => l !== listener) as typeof eventListeners
  }

  emit<K extends EventKey>(event: K, data: CollarEvents[K]): void {
    const eventListeners = this.listeners[event] as Listener<K>[] | undefined
    if (!eventListeners) return
    eventListeners.forEach(listener => listener(data))
  }
}

// Singleton — one bus for the entire extension lifetime
export const eventBus = new EventBus()
