import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ExtensionMessage, WebviewMessage } from '../types'

// ─── VS Code API ──────────────────────────────────────────────────────────────
// The acquireVsCodeApi() function is injected by the webview runtime.
// It can only be called once per webview lifetime.

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void
  getState(): unknown
  setState(state: unknown): void
}

export const vscode = acquireVsCodeApi()

// ─── Mount ────────────────────────────────────────────────────────────────────

const container = document.getElementById('root')!
const root = createRoot(container)
root.render(<App />)

// Tell the extension we're ready — it will respond with 'init'
vscode.postMessage({ type: 'ready' })
