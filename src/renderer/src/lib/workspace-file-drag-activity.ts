import { useSyncExternalStore } from 'react'
import { hasWorkspaceFileDragTypes } from './workspace-file-drag'

// Why: every visible tab group asks the same question during one drag. Share a
// single pair of window listeners instead of registering them per pane.
const subscribers = new Set<() => void>()
let detachWindowListeners: (() => void) | null = null
let snapshot = false

function setSnapshot(next: boolean): void {
  if (snapshot === next) {
    return
  }
  snapshot = next
  for (const subscriber of subscribers) {
    subscriber()
  }
}

function handleDragStart(event: DragEvent): void {
  setSnapshot(Boolean(event.dataTransfer && hasWorkspaceFileDragTypes(event.dataTransfer)))
}

function handleDragFinish(): void {
  setSnapshot(false)
}

export function getWorkspaceFileDragActiveSnapshot(): boolean {
  return snapshot
}

export function subscribeToWorkspaceFileDragActivity(onChange: () => void): () => void {
  subscribers.add(onChange)
  if (!detachWindowListeners && typeof window !== 'undefined') {
    // Why: capture so a stopPropagation inside the explorer row can't hide the
    // gesture from panes that need to arm their drop zones.
    window.addEventListener('dragstart', handleDragStart, true)
    window.addEventListener('dragend', handleDragFinish, true)
    window.addEventListener('drop', handleDragFinish, true)
    detachWindowListeners = () => {
      window.removeEventListener('dragstart', handleDragStart, true)
      window.removeEventListener('dragend', handleDragFinish, true)
      window.removeEventListener('drop', handleDragFinish, true)
    }
  }
  return () => {
    subscribers.delete(onChange)
    if (subscribers.size > 0) {
      return
    }
    detachWindowListeners?.()
    detachWindowListeners = null
    snapshot = false
  }
}

export function useWorkspaceFileDragActive(): boolean {
  return useSyncExternalStore(
    subscribeToWorkspaceFileDragActivity,
    getWorkspaceFileDragActiveSnapshot,
    () => false
  )
}

export function resetWorkspaceFileDragActivityForTests(): void {
  detachWindowListeners?.()
  subscribers.clear()
  detachWindowListeners = null
  snapshot = false
}
