import { afterEach, describe, expect, it } from 'vitest'
import {
  isWebSessionCloseIntentPending,
  recordWebSessionCloseIntent,
  resetWebSessionCloseIntentForTests
} from './web-session-close-intent'
import {
  _getWebSessionFocusOperationTrackingCountsForTest,
  clearReservedWebSessionFocusIntent,
  clearWebSessionFocusIntent,
  consumeWebSessionFocusIntent,
  isWebSessionFocusIntentTokenCurrent,
  peekWebSessionFocusIntent,
  recordReservedWebSessionFocusIntent,
  recordWebSessionFocusIntent,
  reserveWebSessionFocusIntent,
  resetWebSessionFocusIntentForTests,
  runSerializedWebSessionFocusOperation
} from './web-session-focus-intent'
import {
  recordWebSessionReorderIntent,
  resetWebSessionReorderIntentForTests,
  resolveWebSessionReorderedOrder
} from './web-session-reorder-intent'

const WORKTREE_ID = 'repo::/worktree'
const OWNER_A = { environmentId: 'env-a', pairingRevision: 1 }
const OWNER_A_REPAIRED = { environmentId: 'env-a', pairingRevision: 2 }
const OWNER_B = { environmentId: 'env-b', pairingRevision: 1 }

afterEach(() => {
  resetWebSessionCloseIntentForTests()
  resetWebSessionFocusIntentForTests()
  resetWebSessionReorderIntentForTests()
})

describe('web session intent ownership', () => {
  it('isolates close intents across runtimes and same-id re-pairs', () => {
    recordWebSessionCloseIntent(OWNER_A, WORKTREE_ID, 'host-tab', 1_000)

    expect(isWebSessionCloseIntentPending(OWNER_A, WORKTREE_ID, 'host-tab', 1_000)).toBe(true)
    expect(isWebSessionCloseIntentPending(OWNER_A_REPAIRED, WORKTREE_ID, 'host-tab', 1_000)).toBe(
      false
    )
    expect(isWebSessionCloseIntentPending(OWNER_B, WORKTREE_ID, 'host-tab', 1_000)).toBe(false)
  })

  it('isolates focus intents across runtimes and same-id re-pairs', () => {
    recordWebSessionFocusIntent(OWNER_A, WORKTREE_ID, 'host-tab')

    expect(peekWebSessionFocusIntent(OWNER_A, WORKTREE_ID)).toEqual({
      hostTabId: 'host-tab'
    })
    expect(peekWebSessionFocusIntent(OWNER_A_REPAIRED, WORKTREE_ID)).toBeNull()
    expect(peekWebSessionFocusIntent(OWNER_B, WORKTREE_ID)).toBeNull()
  })

  it('does not let an older focus operation overwrite or clear newer intent', () => {
    const older = reserveWebSessionFocusIntent(OWNER_A, WORKTREE_ID)
    expect(older).not.toBeNull()
    recordReservedWebSessionFocusIntent(OWNER_A, WORKTREE_ID, older!, 'host-tab-old')

    recordWebSessionFocusIntent(OWNER_A, WORKTREE_ID, 'host-tab-new')

    expect(recordReservedWebSessionFocusIntent(OWNER_A, WORKTREE_ID, older!, 'host-tab-old')).toBe(
      false
    )
    clearReservedWebSessionFocusIntent(OWNER_A, WORKTREE_ID, older!)
    expect(peekWebSessionFocusIntent(OWNER_A, WORKTREE_ID)).toEqual({
      hostTabId: 'host-tab-new'
    })
  })

  it('consumes rendered intent without canceling its queued operation token', () => {
    const token = reserveWebSessionFocusIntent(OWNER_A, WORKTREE_ID)!
    recordReservedWebSessionFocusIntent(OWNER_A, WORKTREE_ID, token, 'host-tab')

    consumeWebSessionFocusIntent(OWNER_A, WORKTREE_ID)

    expect(peekWebSessionFocusIntent(OWNER_A, WORKTREE_ID)).toBeNull()
    expect(isWebSessionFocusIntentTokenCurrent(OWNER_A, WORKTREE_ID, token)).toBe(true)
  })

  it('cancels every reservation when its worktree is removed', () => {
    const older = reserveWebSessionFocusIntent(OWNER_A, WORKTREE_ID)!
    const latest = reserveWebSessionFocusIntent(OWNER_A, WORKTREE_ID)!

    clearWebSessionFocusIntent(OWNER_A, WORKTREE_ID)

    expect(isWebSessionFocusIntentTokenCurrent(OWNER_A, WORKTREE_ID, latest)).toBe(false)
    expect(recordReservedWebSessionFocusIntent(OWNER_A, WORKTREE_ID, older, 'older')).toBe(false)
    expect(recordReservedWebSessionFocusIntent(OWNER_A, WORKTREE_ID, latest, 'latest')).toBe(false)
  })

  it('coalesces obsolete queued activations during a burst', async () => {
    let releaseFirst!: () => void
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const executed = ['first']
    const first = runSerializedWebSessionFocusOperation(OWNER_A, WORKTREE_ID, async () => {
      await firstBarrier
      return 'first'
    })
    const obsolete = Array.from({ length: 100 }, (_, index) =>
      runSerializedWebSessionFocusOperation<string | null>(
        OWNER_A,
        WORKTREE_ID,
        async () => {
          executed.push(`obsolete-${index}`)
          return `obsolete-${index}`
        },
        { supersededResult: null }
      )
    )
    const latest = runSerializedWebSessionFocusOperation<string | null>(
      OWNER_A,
      WORKTREE_ID,
      async () => {
        executed.push('latest')
        return 'latest'
      },
      { supersededResult: null }
    )

    expect(_getWebSessionFocusOperationTrackingCountsForTest()).toEqual({
      partitions: 1,
      queued: 1
    })
    releaseFirst()

    await expect(first).resolves.toBe('first')
    await expect(Promise.all(obsolete)).resolves.toEqual(Array.from({ length: 100 }, () => null))
    await expect(latest).resolves.toBe('latest')
    expect(executed).toEqual(['first', 'latest'])
    expect(_getWebSessionFocusOperationTrackingCountsForTest()).toEqual({
      partitions: 0,
      queued: 0
    })
  })

  it('isolates reorder intents across runtimes and same-id re-pairs', () => {
    recordWebSessionReorderIntent(OWNER_A, WORKTREE_ID, 'group-1', ['tab-b', 'tab-a'], 1_000)

    expect(
      resolveWebSessionReorderedOrder(OWNER_A, WORKTREE_ID, 'group-1', ['tab-a', 'tab-b'], 1_000)
    ).toEqual(['tab-b', 'tab-a'])
    expect(
      resolveWebSessionReorderedOrder(
        OWNER_A_REPAIRED,
        WORKTREE_ID,
        'group-1',
        ['tab-a', 'tab-b'],
        1_000
      )
    ).toEqual(['tab-a', 'tab-b'])
    expect(
      resolveWebSessionReorderedOrder(OWNER_B, WORKTREE_ID, 'group-1', ['tab-a', 'tab-b'], 1_000)
    ).toEqual(['tab-a', 'tab-b'])
  })
})
