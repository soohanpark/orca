// Why: a remote tab create/activate is the ONE case where the session snapshot's
// activeTabId reflects genuine user focus intent. Status-echo snapshots (e.g. an
// agent "thinking" during a run) also set activeTabId but must NOT steal focus
// (#5435). The snapshot can't distinguish these, so the client records its own
// activation intent here: the reconcile only follows the snapshot's active tab
// when it matches a pending intent the client itself initiated.
//
// Keyed by worktree id → the host session surface the client expects to focus.
// The intent persists until a snapshot matches it (surviving racing/duplicate
// snapshots, unlike a transient per-snapshot flag).

import { webSessionIntentOwnerKey, type WebSessionIntentOwner } from './web-session-intent-owner'

export type WebSessionFocusIntent = {
  hostTabId: string
  leafId?: string
}

export type WebSessionFocusIntentToken = symbol

type PendingWebSessionFocusIntent = {
  intent: WebSessionFocusIntent
  token: WebSessionFocusIntentToken
}

type SerializedWebSessionFocusOperation = {
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  supersede?: () => void
}

type WebSessionFocusOperationQueue = {
  pending: SerializedWebSessionFocusOperation[]
  running: boolean
}

const pendingFocusByOwnerAndWorktree = new Map<string, PendingWebSessionFocusIntent>()
const latestFocusTokenByOwnerAndWorktree = new Map<string, WebSessionFocusIntentToken>()
const reservedFocusTokensByOwnerAndWorktree = new Map<string, Set<WebSessionFocusIntentToken>>()
const focusOperationQueueByOwnerAndWorktree = new Map<string, WebSessionFocusOperationQueue>()

function focusIntentPartitionKey(owner: WebSessionIntentOwner, worktreeId: string): string {
  return `${webSessionIntentOwnerKey(owner)}\0${worktreeId}`
}

export function recordWebSessionFocusIntent(
  owner: WebSessionIntentOwner,
  worktreeId: string,
  hostTabId: string,
  leafId?: string
): WebSessionFocusIntentToken | null {
  const trimmed = hostTabId.trim()
  if (!worktreeId || !trimmed) {
    return null
  }
  const key = focusIntentPartitionKey(owner, worktreeId)
  const token = Symbol(key)
  const trimmedLeafId = leafId?.trim()
  latestFocusTokenByOwnerAndWorktree.set(key, token)
  pendingFocusByOwnerAndWorktree.set(key, {
    token,
    intent: {
      hostTabId: trimmed,
      ...(trimmedLeafId ? { leafId: trimmedLeafId } : {})
    }
  })
  return token
}

export function reserveWebSessionFocusIntent(
  owner: WebSessionIntentOwner,
  worktreeId: string
): WebSessionFocusIntentToken | null {
  if (!worktreeId) {
    return null
  }
  const key = focusIntentPartitionKey(owner, worktreeId)
  const token = Symbol(key)
  latestFocusTokenByOwnerAndWorktree.set(key, token)
  const reservedTokens = reservedFocusTokensByOwnerAndWorktree.get(key) ?? new Set()
  reservedTokens.add(token)
  reservedFocusTokensByOwnerAndWorktree.set(key, reservedTokens)
  pendingFocusByOwnerAndWorktree.delete(key)
  return token
}

export function recordReservedWebSessionFocusIntent(
  owner: WebSessionIntentOwner,
  worktreeId: string,
  token: WebSessionFocusIntentToken,
  hostTabId: string,
  leafId?: string
): boolean {
  const key = focusIntentPartitionKey(owner, worktreeId)
  const trimmed = hostTabId.trim()
  if (
    !trimmed ||
    latestFocusTokenByOwnerAndWorktree.get(key) !== token ||
    !reservedFocusTokensByOwnerAndWorktree.get(key)?.has(token)
  ) {
    return false
  }
  const trimmedLeafId = leafId?.trim()
  pendingFocusByOwnerAndWorktree.set(key, {
    token,
    intent: {
      hostTabId: trimmed,
      ...(trimmedLeafId ? { leafId: trimmedLeafId } : {})
    }
  })
  return true
}

export function isWebSessionFocusIntentTokenCurrent(
  owner: WebSessionIntentOwner,
  worktreeId: string,
  token: WebSessionFocusIntentToken
): boolean {
  return (
    latestFocusTokenByOwnerAndWorktree.get(focusIntentPartitionKey(owner, worktreeId)) === token &&
    isWebSessionFocusIntentTokenValid(owner, worktreeId, token)
  )
}

export function isWebSessionFocusIntentTokenValid(
  owner: WebSessionIntentOwner,
  worktreeId: string,
  token: WebSessionFocusIntentToken
): boolean {
  return (
    reservedFocusTokensByOwnerAndWorktree
      .get(focusIntentPartitionKey(owner, worktreeId))
      ?.has(token) === true
  )
}

async function drainWebSessionFocusOperationQueue(
  key: string,
  queue: WebSessionFocusOperationQueue
): Promise<void> {
  if (queue.running) {
    return
  }
  queue.running = true
  while (queue.pending.length > 0) {
    const next = queue.pending.shift()!
    try {
      next.resolve(await next.run())
    } catch (error) {
      next.reject(error)
    }
  }
  queue.running = false
  if (focusOperationQueueByOwnerAndWorktree.get(key) === queue) {
    focusOperationQueueByOwnerAndWorktree.delete(key)
  }
}

export function runSerializedWebSessionFocusOperation<T>(
  owner: WebSessionIntentOwner,
  worktreeId: string,
  operation: () => Promise<T>,
  options: { supersededResult: T } | undefined = undefined
): Promise<T> {
  const key = focusIntentPartitionKey(owner, worktreeId)
  let queue = focusOperationQueueByOwnerAndWorktree.get(key)
  if (!queue) {
    queue = { pending: [], running: false }
    focusOperationQueueByOwnerAndWorktree.set(key, queue)
  }
  for (let index = queue.pending.length - 1; index >= 0; index -= 1) {
    const pending = queue.pending[index]
    if (pending?.supersede) {
      queue.pending.splice(index, 1)
      pending.supersede()
    }
  }
  const promise = new Promise<T>((resolve, reject) => {
    queue!.pending.push({
      run: operation,
      resolve: (value) => resolve(value as T),
      reject,
      ...(options ? { supersede: () => resolve(options.supersededResult) } : {})
    })
  })
  void drainWebSessionFocusOperationQueue(key, queue)
  return promise
}

export function clearReservedWebSessionFocusIntent(
  owner: WebSessionIntentOwner,
  worktreeId: string,
  token: WebSessionFocusIntentToken
): void {
  const key = focusIntentPartitionKey(owner, worktreeId)
  if (latestFocusTokenByOwnerAndWorktree.get(key) !== token) {
    return
  }
  latestFocusTokenByOwnerAndWorktree.delete(key)
  const reservedTokens = reservedFocusTokensByOwnerAndWorktree.get(key)
  reservedTokens?.delete(token)
  if (reservedTokens?.size === 0) {
    reservedFocusTokensByOwnerAndWorktree.delete(key)
  }
  if (pendingFocusByOwnerAndWorktree.get(key)?.token === token) {
    pendingFocusByOwnerAndWorktree.delete(key)
  }
}

export function releaseWebSessionFocusIntentToken(
  owner: WebSessionIntentOwner,
  worktreeId: string,
  token: WebSessionFocusIntentToken
): void {
  const key = focusIntentPartitionKey(owner, worktreeId)
  if (latestFocusTokenByOwnerAndWorktree.get(key) === token) {
    latestFocusTokenByOwnerAndWorktree.delete(key)
  }
  const reservedTokens = reservedFocusTokensByOwnerAndWorktree.get(key)
  reservedTokens?.delete(token)
  if (reservedTokens?.size === 0) {
    reservedFocusTokensByOwnerAndWorktree.delete(key)
  }
}

export function peekWebSessionFocusIntent(
  owner: WebSessionIntentOwner,
  worktreeId: string
): WebSessionFocusIntent | null {
  return (
    pendingFocusByOwnerAndWorktree.get(focusIntentPartitionKey(owner, worktreeId))?.intent ?? null
  )
}

export function consumeWebSessionFocusIntent(
  owner: WebSessionIntentOwner,
  worktreeId: string
): void {
  pendingFocusByOwnerAndWorktree.delete(focusIntentPartitionKey(owner, worktreeId))
}

export function clearWebSessionFocusIntent(owner: WebSessionIntentOwner, worktreeId: string): void {
  const key = focusIntentPartitionKey(owner, worktreeId)
  pendingFocusByOwnerAndWorktree.delete(key)
  latestFocusTokenByOwnerAndWorktree.delete(key)
  reservedFocusTokensByOwnerAndWorktree.delete(key)
}

export function clearWebSessionFocusIntentsForOwner(owner: WebSessionIntentOwner): void {
  const prefix = `${webSessionIntentOwnerKey(owner)}\0`
  for (const key of pendingFocusByOwnerAndWorktree.keys()) {
    if (key.startsWith(prefix)) {
      pendingFocusByOwnerAndWorktree.delete(key)
    }
  }
  for (const key of latestFocusTokenByOwnerAndWorktree.keys()) {
    if (key.startsWith(prefix)) {
      latestFocusTokenByOwnerAndWorktree.delete(key)
    }
  }
  for (const key of reservedFocusTokensByOwnerAndWorktree.keys()) {
    if (key.startsWith(prefix)) {
      reservedFocusTokensByOwnerAndWorktree.delete(key)
    }
  }
}

export function resetWebSessionFocusIntentForTests(): void {
  pendingFocusByOwnerAndWorktree.clear()
  latestFocusTokenByOwnerAndWorktree.clear()
  reservedFocusTokensByOwnerAndWorktree.clear()
  focusOperationQueueByOwnerAndWorktree.clear()
}

export function _getWebSessionFocusOperationTrackingCountsForTest(): {
  partitions: number
  queued: number
} {
  let queued = 0
  for (const queue of focusOperationQueueByOwnerAndWorktree.values()) {
    queued += queue.pending.length
  }
  return { partitions: focusOperationQueueByOwnerAndWorktree.size, queued }
}
