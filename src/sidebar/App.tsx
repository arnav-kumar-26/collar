import React, { useState, useEffect } from 'react'
import { vscode } from './index'
import { ExtensionMessage, User, Violation, Rule } from '../core/models'
import Chat from './tabs/Chat'
import Violations from './tabs/Violations'
import Rules from './tabs/Rules'
import History from './tabs/History'

// ─── Tab Registry ─────────────────────────────────────────────────────────────
// Tabs are defined here. Adding a new tab only requires adding to this array.
// App.tsx never needs structural changes — just add an entry.

const TABS = [
  { id: 'chat',       label: 'Chat',       component: Chat       },
  { id: 'violations', label: 'Violations', component: Violations },
  { id: 'rules',      label: 'Rules',      component: Rules      },
  { id: 'history',    label: 'History',    component: History    },
] as const

type TabId = typeof TABS[number]['id']

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('violations')
  const [user, setUser] = useState<User | null>(null)
  const [violations, setViolations] = useState<Violation[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [branch, setBranch] = useState<string>('')
  const [isAnalysing, setIsAnalysing] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // ── Message listener — receives all events from the extension host ─────────
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data

      switch (message.type) {
        case 'init':
          setUser(message.data.user)
          setViolations(message.data.violations)
          setRules(message.data.rules)
          setBranch(message.data.branch)
          setIsReady(true)
          break

        case 'violationsUpdated':
          setViolations(message.data)
          setIsAnalysing(false)
          break

        case 'ruleUpdated':
          setRules(prev => {
            const index = prev.findIndex(r => r.id === message.data.id)
            if (index === -1) return [...prev, message.data]
            const updated = [...prev]
            updated[index] = message.data
            return updated
          })
          break

        case 'branchChanged':
          setBranch(message.data)
          break

        case 'analysisStarted':
          setIsAnalysing(true)
          break

        case 'authDenied':
          // TODO: show denied screen
          setIsReady(true)
          setAuthError('Access denied. Ask your admin to add your GitHub email.')
          break
        case 'notSignedIn':
          setIsReady(true)
          setAuthError(null)    // no error, just not signed in yet
          break 

        case 'authSuccess':
          setUser(message.data)
          setIsReady(true) 
          break
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // ── Violation counts for tab badge ────────────────────────────────────────
  const counts = {
    critical: violations.filter(v => v.status === 'active').length,  // TODO: filter by severity
    major: 0,
    minor: 0,
  }

  if (!isReady) {
  return (
    <div style={styles.loading}>
      <span>Loading Collar...</span>
    </div>
  )
}

if (!user) {
  return <SignIn error={authError}/>
}

  const ActiveComponent = TABS.find(t => t.id === activeTab)!.component

  return (
    <div style={styles.root}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.branchBadge}>
          <span style={styles.branchIcon}>⎇</span>
          <span>{branch || 'unknown'}</span>
        </div>
        {isAnalysing && <span style={styles.spinner}>⟳ Analysing</span>}
        {user && (
          <div style={styles.avatar} title={`${user.name} (${user.role})`}>
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'violations' && violations.length > 0 && (
              <span style={styles.badge}>{violations.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      <div style={styles.content}>
        <ActiveComponent
          violations={violations}
          rules={rules}
          user={user}
          branch={branch}
          onNavigateToChat={() => setActiveTab('chat')}
        />
      </div>
    </div>
  )
}

function SignIn({ error }: { error: string | null }) {
  const handleSignIn = () => {
    vscode.postMessage({ type: 'signIn' })
  }

  return (
    <div style={signInStyles.root}>
      <div style={signInStyles.logo}>⬡</div>
      <h2 style={signInStyles.title}>Collar</h2>
      <p style={signInStyles.subtitle}>
        LLM-powered code validation for your team
      </p>
      {error && (
        <p style={signInStyles.error}>{error}</p>
      )}
      <button style={signInStyles.button} onClick={handleSignIn}>
        Sign in with GitHub
      </button>
      <p style={signInStyles.hint}>
        You need an invitation from your admin to access Collar.
      </p>
    </div>
  )
}

const signInStyles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    padding: '0 24px',
    gap: 12,
    textAlign: 'center',
  },
  error: {
    fontSize: 11,
    color: 'var(--vscode-errorForeground)',
    margin: 0,
    lineHeight: 1.5,
    textAlign: 'center',
  },
  logo: {
    fontSize: 48,
    lineHeight: 1,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    margin: 0,
  },
  subtitle: {
    fontSize: 12,
    opacity: 0.6,
    margin: 0,
    lineHeight: 1.5,
  },
  button: {
    marginTop: 16,
    padding: '8px 20px',
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: 4,
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 600,
  },
  hint: {
    fontSize: 11,
    opacity: 0.4,
    margin: 0,
    lineHeight: 1.5,
  },
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Using VS Code CSS variables so the sidebar matches the user's theme automatically

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    color: 'var(--vscode-foreground)',
    opacity: 0.6,
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid var(--vscode-panel-border)',
    flexShrink: 0,
  },
  branchBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    opacity: 0.7,
  },
  branchIcon: { fontSize: 13 },
  spinner: {
    fontSize: 11,
    opacity: 0.6,
    animation: 'spin 1s linear infinite',
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'default',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid var(--vscode-panel-border)',
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    padding: '6px 4px',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--vscode-foreground)',
    fontSize: 11,
    cursor: 'pointer',
    opacity: 0.6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabActive: {
    opacity: 1,
    borderBottom: '2px solid var(--vscode-focusBorder)',
  },
  badge: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: 10,
    padding: '0 5px',
    fontSize: 10,
    fontWeight: 700,
  },
  content: {
    flex: 1,
    overflow: 'auto',
  },
}
