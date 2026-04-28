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
  const [authState, setAuthState] = useState<'loading' | 'needsCredentials' | 'needsSignIn' | 'ready'>('loading')

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
          setAuthState('ready')
          break

        case 'needsCredentials':
          setAuthState('needsCredentials')
          break

        case 'needsSignIn':
          setAuthState('needsSignIn')
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
          // Show denied screen
          setAuthState('authDenied')
          break

        case 'authSuccess':
          setUser(message.data)
          setAuthState('ready')
          break
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // ── Render different screens based on auth state ────────────────────────
  if (authState === 'loading') {
    return (
      <div style={styles.loading}>
        <span>Loading Collar...</span>
      </div>
    )
  }

  if (authState === 'needsCredentials') {
    return <CredentialsScreen />
  }

  if (authState === 'needsSignIn') {
    return <SignInScreen />
  }

  if (authState === 'authDenied') {
    return <AccessDeniedScreen />
  }

  if (authState === 'ready') {
    return <AuthenticatedApp
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      user={user}
      violations={violations}
      rules={rules}
      branch={branch}
      isAnalysing={isAnalysing}
    />
  }

  return null
}

// ─── Authenticated App ───────────────────────────────────────────────────────

function AuthenticatedApp({ activeTab, setActiveTab, user, violations, rules, branch, isAnalysing }: {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  user: User | null
  violations: Violation[]
  rules: Rule[]
  branch: string
  isAnalysing: boolean
}) {
  // ── Violation counts for tab badge ────────────────────────────────────────
  const counts = {
    critical: violations.filter(v => v.status === 'active').length,  // TODO: filter by severity
    major: 0,
    minor: 0,
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

// ─── Authentication Screens ──────────────────────────────────────────────────

function CredentialsScreen() {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!url || !key) return

    setIsSubmitting(true)
    vscode.postMessage({
      type: 'setCredentials',
      url,
      key
    })
  }

  return (
    <div style={styles.authScreen}>
      <div style={styles.authContent}>
        <h2 style={styles.authTitle}>Connect to Supabase</h2>
        <p style={styles.authDescription}>
          Enter your Supabase project URL and anon key to get started.
        </p>

        <div style={styles.formGroup}>
          <label style={styles.label}>Project URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-project.supabase.co"
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Anon Key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="eyJ..."
            style={styles.input}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!url || !key || isSubmitting}
          style={{
            ...styles.button,
            ...(isSubmitting ? styles.buttonDisabled : {})
          }}
        >
          {isSubmitting ? 'Connecting...' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

function SignInScreen() {
  return (
    <div style={styles.authScreen}>
      <div style={styles.authContent}>
        <h2 style={styles.authTitle}>Sign In</h2>
        <p style={styles.authDescription}>
          Sign in with your GitHub account to access Collar.
        </p>

        <button
          onClick={() => vscode.postMessage({ type: 'signIn' })}
          style={styles.button}
        >
          Continue with GitHub
        </button>
      </div>
    </div>
  )
}

function AccessDeniedScreen() {
  return (
    <div style={styles.authScreen}>
      <div style={styles.authContent}>
        <h2 style={styles.authTitle}>Access Denied</h2>
        <p style={styles.authDescription}>
          Your GitHub email is not invited to this Collar project.
          Ask your admin to add your email to the invitations list.
        </p>

        <button
          onClick={() => vscode.postMessage({ type: 'signIn' })}
          style={styles.buttonSecondary}
        >
          Try Different Account
        </button>
      </div>
    </div>
  )
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
  authScreen: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    padding: 20,
  },
  authContent: {
    textAlign: 'center',
    maxWidth: 300,
  },
  authTitle: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 8,
    color: 'var(--vscode-foreground)',
  },
  authDescription: {
    fontSize: 13,
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: 20,
    lineHeight: 1.4,
  },
  formGroup: {
    marginBottom: 16,
    textAlign: 'left',
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    marginBottom: 4,
    color: 'var(--vscode-foreground)',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: 3,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    fontSize: 13,
  },
  button: {
    width: '100%',
    padding: '10px 16px',
    border: 'none',
    borderRadius: 3,
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  buttonSecondary: {
    width: '100%',
    padding: '10px 16px',
    border: '1px solid var(--vscode-button-border)',
    borderRadius: 3,
    background: 'var(--vscode-button-secondaryBackground)',
    color: 'var(--vscode-button-secondaryForeground)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
}
