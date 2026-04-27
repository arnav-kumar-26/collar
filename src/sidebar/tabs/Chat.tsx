import React, { useState, useRef, useEffect } from 'react'
import { vscode } from '../index'
import { User, Violation, Rule } from '../../types'

interface Props {
  violations: Violation[]
  rules: Rule[]
  user: User | null
  branch: string
  onNavigateToChat: () => void
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: Date
  isThinking?: boolean
}

const SUGGESTED_PROMPTS = [
  'Explain my most critical violation',
  'What is rule BR-014?',
  'Why does the security rule apply here?',
  'How do I fix the architectural violation?',
]

export default function ChatTab({ violations, rules, user }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  const sendMessage = async (text: string) => {
    if (!text.trim() || isThinking) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: text.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsThinking(true)

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    // Send to extension host — it forwards to the Edge Function / LLM
    vscode.postMessage({ type: 'chatMessage', text: text.trim() })

    // Listen for the response (single message listener for this send)
    // In production this would be handled by the App-level message listener
    // and passed down as a prop. For now, simulating:
    setTimeout(() => {
      setIsThinking(false)
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: 'This is where the LLM response will appear. The chat feature calls the Edge Function and streams the explanation back here.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMessage])
    }, 1500)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div style={styles.root}>
      {/* Messages area */}
      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>Ask Collar anything</p>
            <p style={styles.emptyHint}>
              Collar explains violations and rules. It does not take actions.
            </p>
            <div style={styles.suggestedPrompts}>
              {SUGGESTED_PROMPTS.map(prompt => (
                <button
                  key={prompt}
                  style={styles.promptChip}
                  onClick={() => sendMessage(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <div
            key={message.id}
            style={{
              ...styles.bubble,
              ...(message.role === 'user' ? styles.userBubble : styles.assistantBubble),
            }}
          >
            <p style={styles.bubbleText}>{message.text}</p>
            <span style={styles.timestamp}>
              {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}

        {isThinking && (
          <div style={{ ...styles.bubble, ...styles.assistantBubble }}>
            <p style={{ ...styles.bubbleText, opacity: 0.5 }}>Thinking...</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div style={styles.composer}>
        <textarea
          ref={textareaRef}
          style={styles.textarea}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a violation or rule... (Enter to send, Shift+Enter for new line)"
          rows={1}
          maxLength={4000}
        />
        <div style={styles.composerFooter}>
          <span style={styles.charCount}>{input.length}/4000</span>
          <button
            style={{
              ...styles.sendButton,
              opacity: input.trim() && !isThinking ? 1 : 0.4,
            }}
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isThinking}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%' },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '20px 0',
  },
  emptyTitle: { fontWeight: 600, fontSize: 13 },
  emptyHint: { fontSize: 11, opacity: 0.6, lineHeight: 1.5 },
  suggestedPrompts: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  promptChip: {
    background: 'var(--vscode-editor-inactiveSelectionBackground)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 12,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
    color: 'var(--vscode-foreground)',
  },
  bubble: {
    maxWidth: '85%',
    padding: '8px 12px',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  userBubble: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 2,
  },
  assistantBubble: {
    background: 'var(--vscode-editor-inactiveSelectionBackground)',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 2,
  },
  bubbleText: { fontSize: 12, lineHeight: 1.6 },
  timestamp: { fontSize: 9, opacity: 0.5, alignSelf: 'flex-end' },
  composer: {
    borderTop: '1px solid var(--vscode-panel-border)',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  textarea: {
    width: '100%',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: 4,
    padding: '6px 8px',
    fontSize: 12,
    resize: 'none',
    fontFamily: 'var(--vscode-font-family)',
    lineHeight: 1.5,
    outline: 'none',
  },
  composerFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCount: { fontSize: 10, opacity: 0.4 },
  sendButton: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: 3,
    padding: '3px 12px',
    fontSize: 11,
    cursor: 'pointer',
  },
}
