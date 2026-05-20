import React from 'react'
import { Violation, Rule, User } from '../../core/models'

interface Props {
  violations: Violation[]
  rules: Rule[]
  user: User | null
  branch: string
  onNavigateToChat: () => void
}

export default function ViolationsTab({ violations, rules, onNavigateToChat }: Props) {
  const active = violations.filter(v => v.status === 'active')
  const critical = active.filter(v => getSeverity(v, rules) === 'critical')
  const major    = active.filter(v => getSeverity(v, rules) === 'major')
  const minor    = active.filter(v => getSeverity(v, rules) === 'minor')

  return (
    <div style={styles.root}>
      {/* Summary row */}
      <div style={styles.summary}>
        <SummaryChip count={critical.length} label="critical" color="#dc2626" />
        <SummaryChip count={major.length}    label="major"    color="#d97706" />
        <SummaryChip count={minor.length}    label="minor"    color="#16a34a" />
      </div>

      {active.length === 0 ? (
        <div style={styles.empty}>
          <span>✓ No active violations</span>
        </div>
      ) : (
        <div style={styles.list}>
          {active.map(violation => (
            <ViolationCard
              key={violation.id}
              violation={violation}
              rule={rules.find(r => r.id === violation.rule_id)}
              onChatClick={() => onNavigateToChat()}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryChip({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div style={{ ...styles.chip, borderLeft: `3px solid ${color}` }}>
      <span style={{ ...styles.chipCount, color }}>{count}</span>
      <span style={styles.chipLabel}>{label}</span>
    </div>
  )
}

function ViolationCard({
  violation,
  rule,
  onChatClick,
}: {
  violation: Violation
  rule: Rule | undefined
  onChatClick: () => void
}) {
  const severity = rule?.severity ?? 'major'
  const borderColor = severity === 'critical' ? '#dc2626' : severity === 'major' ? '#d97706' : '#16a34a'

  return (
    <div style={{ ...styles.card, borderLeft: `3px solid ${borderColor}` }}>
      <div style={styles.cardHeader}>
        <span style={styles.ruleId}>{violation.rule_id}</span>
        <span style={styles.category}>{rule?.category ?? ''}</span>
      </div>
      <div style={styles.filePath}>
        {violation.file_path.split('/').slice(-2).join('/')}
        {violation.line_start > 0 && (
          <span style={styles.lineNum}>:{violation.line_start}</span>
        )}
      </div>
      <p style={styles.explanation}>{violation.explanation}</p>
      {violation.code_excerpt && (
        <pre style={styles.codeExcerpt}>{violation.code_excerpt}</pre>
      )}
      <button style={styles.chatButton} onClick={onChatClick}>
        Explain in Chat →
      </button>
    </div>
  )
}

function getSeverity(violation: Violation, rules: Rule[]) {
  return rules.find(r => r.id === violation.rule_id)?.severity ?? 'major'
}

const styles: Record<string, React.CSSProperties> = {
  root: { padding: 12, display: 'flex', flexDirection: 'column', gap: 12 },
  summary: { display: 'flex', gap: 8 },
  chip: {
    flex: 1,
    padding: '6px 10px',
    background: 'var(--vscode-editor-inactiveSelectionBackground)',
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  chipCount: { fontSize: 18, fontWeight: 700, lineHeight: 1 },
  chipLabel: { fontSize: 10, opacity: 0.7, marginTop: 2 },
  empty: {
    textAlign: 'center',
    padding: '40px 0',
    opacity: 0.5,
    fontSize: 13,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: {
    background: 'var(--vscode-editor-inactiveSelectionBackground)',
    borderRadius: 4,
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  ruleId: { fontWeight: 700, fontSize: 12 },
  category: {
    fontSize: 10,
    opacity: 0.6,
    background: 'var(--vscode-badge-background)',
    padding: '1px 6px',
    borderRadius: 10,
  },
  filePath: { fontSize: 11, opacity: 0.7, fontFamily: 'monospace', overflowWrap: 'break-word', wordBreak: 'break-all' },
  lineNum: { opacity: 0.5 },
  explanation: { fontSize: 12, lineHeight: 1.5, overflowWrap: 'break-word' },
  codeExcerpt: {
    fontSize: 11,
    background: 'var(--vscode-textBlockQuote-background)',
    padding: '4px 8px',
    borderRadius: 3,
    overflow: 'auto',
    fontFamily: 'var(--vscode-editor-font-family)',
  },
  chatButton: {
    alignSelf: 'flex-start',
    background: 'none',
    border: 'none',
    color: 'var(--vscode-textLink-foreground)',
    fontSize: 11,
    cursor: 'pointer',
    padding: 0,
    marginTop: 2,
  },
}
