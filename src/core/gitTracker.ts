import * as vscode from 'vscode'
import { eventBus } from './eventBus'

// Uses the built-in VS Code Git extension API
// This avoids shelling out to git commands

interface GitExtension {
  getAPI(version: 1): GitAPI
}

interface GitAPI {
  repositories: GitRepository[]
  onDidOpenRepository: vscode.Event<GitRepository>
}

interface GitRepository {
  state: {
    HEAD: { name?: string; commit?: string } | undefined
    onDidChange: vscode.Event<void>
  }
  log(options: { maxEntries: number }): Promise<{ hash: string; message: string }[]>
}

// ─── GitTracker ──────────────────────────────────────────────────────────────

export async function startGitTracker(): Promise<vscode.Disposable[]> {
  const disposables: vscode.Disposable[] = []

  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')

  if (!gitExtension) {
    console.warn('[Collar] Git extension not found — git tracking disabled')
    return disposables
  }

  const git = gitExtension.isActive
    ? gitExtension.exports.getAPI(1)
    : (await gitExtension.activate()).getAPI(1)

  function watchRepository(repo: GitRepository) {
    let lastBranch = repo.state.HEAD?.name
    let lastCommit = repo.state.HEAD?.commit

    const stateChange = repo.state.onDidChange(async () => {
      const head = repo.state.HEAD
      if (!head) return

      const currentBranch = head.name
      const currentCommit = head.commit

      // Branch switched
      if (currentBranch && currentBranch !== lastBranch) {
        lastBranch = currentBranch
        eventBus.emit('branch:switched', { branch: currentBranch })
      }

      // New commit
      if (currentCommit && currentCommit !== lastCommit) {
        lastCommit = currentCommit

        // Get the commit message from git log
        let message = ''
        try {
          const logs = await repo.log({ maxEntries: 1 })
          message = logs[0]?.message ?? ''
        } catch {
          message = ''
        }

        eventBus.emit('commit:made', {
          sha: currentCommit,
          branch: currentBranch ?? 'unknown',
          message,
        })
      }
    })

    disposables.push(stateChange)
  }

  // Watch any already-open repositories
  git.repositories.forEach(watchRepository)

  // Watch repositories opened after startup
  const onOpen = git.onDidOpenRepository(watchRepository)
  disposables.push(onOpen)

  return disposables
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getCurrentBranch(): string | undefined {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')
  if (!gitExtension?.isActive) return undefined
  const git = gitExtension.exports.getAPI(1)
  return git.repositories[0]?.state.HEAD?.name
}

export function getCurrentCommit(): string | undefined {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')
  if (!gitExtension?.isActive) return undefined
  const git = gitExtension.exports.getAPI(1)
  return git.repositories[0]?.state.HEAD?.commit
}
