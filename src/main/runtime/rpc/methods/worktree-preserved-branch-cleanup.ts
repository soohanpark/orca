import { defineMethod, type RpcMethod } from '../core'
import { WorktreeReleasePreservedBranchCleanups } from './worktree-schemas'

export const WORKTREE_PRESERVED_BRANCH_CLEANUP_METHOD: RpcMethod = defineMethod({
  name: 'worktree.releasePreservedBranchCleanups',
  params: WorktreeReleasePreservedBranchCleanups,
  handler: async (params, { runtime }) => runtime.releasePreservedBranchCleanups(params.cleanups)
})
