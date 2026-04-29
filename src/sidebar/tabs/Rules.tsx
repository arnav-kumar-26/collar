import React, { useState } from 'react'
import { Rule, RuleCategory, User, Violation } from '../../core/models'

interface Props {
  violations: Violation[]
  rules: Rule[]
  user: User | null
  branch: string
  onNavigateToChat: () => void
}

const CATEGORY_LABELS: Record<RuleCategory, string> = {
  business:      'Business',
  architectural: 'Architectural',
  security:      'Security',
  test:          'Test',
}

const SEVERITY_COLORS = {
  critical: '#dc2626',
  major:    '#d97706',
  minor:    '#16a34a',
}

export default function RulesTab({ rules }: Props) {
  const [collapsed, setCollapsed] = useState<Set<RuleCategory>>(new Set())

  const categories = Object.keys(CATEGORY_LABELS) as RuleCategory[]

  const toggle = (cat: RuleCategory) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  return (
    <div style={styles.root}>
      <p style={styles.hint}>Rules are read-only. Contact your admin to request changes.</p>
      {categories.map(cat => {
        const catRules = rules.filter(r => r.category === cat && r.status === 'active')
        if (catRules.length === 0) return null
        const isCollapsed = collapsed.has(cat)

        return (
          <div key={cat}>
            <button style={styles.categoryHeader} onClick={() => toggle(cat)}>
              <span style={styles.categoryLabel}>{CATEGORY_LABELS[cat]}</span>
              <span style={styles.categoryCount}>{catRules.length}</span>
              <span style={styles.chevron}>{isCollapsed ? '›' : '⌄'}</span>
            </button>

            {!isCollapsed && (
              <div style={styles.ruleList}>
                {catRules.map(rule => (
                  <RuleRow key={rule.id} rule={rule} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RuleRow({ rule }: { rule: Rule }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={styles.ruleRow}>
      <div style={styles.ruleHeader} onClick={() => setExpanded(!expanded)}>
        <span style={styles.ruleId}>{rule.id}</span>
        <span style={styles.ruleName}>{rule.name}</span>
        <span style={{ ...styles.severityBadge, background: SEVERITY_COLORS[rule.severity] }}>
          {rule.severity}
        </span>
      </div>
      {expanded && (
        <p style={styles.ruleDescription}>{rule.description}</p>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column' },
  hint: { fontSize: 11, opacity: 0.5, padding: '8px 12px', fontStyle: 'italic' },
  categoryHeader: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: 'var(--vscode-sideBarSectionHeader-background)',
    border: 'none',
    borderTop: '1px solid var(--vscode-panel-border)',
    color: 'var(--vscode-foreground)',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  categoryLabel: { flex: 1 },
  categoryCount: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: 10,
    padding: '0 6px',
    fontSize: 10,
  },
  chevron: { opacity: 0.5, fontSize: 14 },
  ruleList: { display: 'flex', flexDirection: 'column' },
  ruleRow: {
    borderBottom: '1px solid var(--vscode-panel-border)',
    padding: '0 12px',
  },
  ruleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 0',
    cursor: 'pointer',
  },
  ruleId: { fontFamily: 'monospace', fontSize: 11, opacity: 0.7, flexShrink: 0 },
  ruleName: { flex: 1, fontSize: 12 },
  severityBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 10,
    color: '#fff',
    fontWeight: 600,
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  ruleDescription: {
    fontSize: 12,
    lineHeight: 1.6,
    opacity: 0.8,
    paddingBottom: 10,
  },
}
