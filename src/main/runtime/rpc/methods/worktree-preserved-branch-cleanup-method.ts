import { defineMethod, type RpcMethod } from '../core'
import { WorktreeReleasePreservedBranchCleanups } from './worktree-schemas'

export const WORKTREE_RELEASE_PRESERVED_BRANCH_CLEANUPS_METHOD: RpcMethod = defineMethod({
  name: 'worktree.releasePreservedBranchCleanups',
  params: WorktreeReleasePreservedBranchCleanups,
  handler: async (params, { runtime }) =>
    runtime.releasePreservedBranchCleanups(
      params.cleanups.map((cleanup) => ({
        worktreeSelector: cleanup.worktree,
        branchName: cleanup.branchName,
        expectedHead: cleanup.expectedHead,
        ...(cleanup.hostId ? { hostId: cleanup.hostId } : {})
      }))
    )
})
