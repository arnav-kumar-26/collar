import React from 'react'
import { User } from '../../core/models'

interface Props {
  violations: never[]
  rules: never[]
  user: User | null
  branch: string
  onNavigateToChat: () => void
}

// History data is fetched directly from Supabase by this component
// once the history tab gains its own data fetching (future: via event bus or service call)

interface HistoryEntry {
  sha: string
  shortSha: string
  message: string
  author: string
  timestamp: string
  branch: string
  delta: { critical: number; major: number; minor: number }
  trigger: 'commit' | 'manual' | 'rule_update'
  isInherited: boolean  // true = from parent branch before fork
}

export default function HistoryTab({ branch }: Props) {
  // Placeholder — real data will come from a useEffect calling db.getCommitHistory
  const entries: HistoryEntry[] = []

  return (
    <div style={styles.root}>
      {entries.length === 0 ? (
        <div style={styles.empty}>
          <span>No history yet on <code>{branch}</code></span>
          <p style={styles.emptyHint}>History appears after your first commit or manual analysis.</p>
        </div>
      ) : (
        <div style={styles.timeline}>
          {entries.map((entry, i) => (
            <HistoryRow key={entry.sha} entry={entry} isLast={i === entries.length - 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryRow({ entry, isLast }: { entry: HistoryEntry; isLast: boolean }) {
  return (
    <div style={{ ...styles.row, opacity: entry.isInherited ? 0.5 : 1 }}>
      {/* Timeline line */}
      <div style={styles.timelineColumn}>
        <div style={styles.dot} />
        {!isLast && <div style={styles.line} />}
      </div>

      <div style={styles.rowContent}>
        <div style={styles.rowHeader}>
          <code style={styles.sha}>{entry.shortSha}</code>
          {entry.trigger !== 'commit' && (
            <span style={styles.triggerBadge}>{entry.trigger}</span>
          )}
          {entry.isInherited && (
            <span style={styles.inheritedBadge}>inherited</span>
          )}
          <span style={styles.timestamp}>{formatTime(entry.timestamp)}</span>
        </div>

        <p style={styles.message}>{entry.message}</p>
        <span style={styles.author}>{entry.author}</span>

        {/* Violation delta */}
        <div style={styles.delta}>
          <DeltaChip value={entry.delta.critical} label="critical" color="#dc2626" />
          <DeltaChip value={entry.delta.major}    label="major"    color="#d97706" />
          <DeltaChip value={entry.delta.minor}    label="minor"    color="#16a34a" />
        </div>
      </div>
    </div>
  )
}

function DeltaChip({ value, label, color }: { value: number; label: string; color: string }) {
  if (value === 0) return null
  const sign = value > 0 ? '+' : ''
  return (
    <span style={{ ...styles.deltaChip, color }}>
      {sign}{value} {label}
    </span>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const styles: Record<string, React.CSSProperties> = {
  root: { padding: 12 },
  empty: {
    textAlign: 'center',
    padding: '40px 0',
    opacity: 0.5,
    fontSize: 13,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emptyHint: { fontSize: 11 },
  timeline: { display: 'flex', flexDirection: 'column' },
  row: { display: 'flex', gap: 12 },
  timelineColumn: { display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--vscode-focusBorder)',
    marginTop: 4,
    flexShrink: 0,
  },
  line: {
    width: 1,
    flex: 1,
    background: 'var(--vscode-panel-border)',
    marginTop: 4,
  },
  rowContent: {
    flex: 1,
    paddingBottom: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  rowHeader: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sha: { fontSize: 11, opacity: 0.7 },
  triggerBadge: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 3,
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
  },
  inheritedBadge: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 3,
    border: '1px solid var(--vscode-panel-border)',
    opacity: 0.6,
  },
  timestamp: { fontSize: 10, opacity: 0.5, marginLeft: 'auto' },
  message: { fontSize: 12 },
  author: { fontSize: 11, opacity: 0.6 },
  delta: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  deltaChip: { fontSize: 11, fontWeight: 600 },
}
