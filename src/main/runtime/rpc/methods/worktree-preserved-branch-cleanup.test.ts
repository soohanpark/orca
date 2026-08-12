import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { WORKTREE_PRESERVED_BRANCH_CLEANUP_METHOD } from './worktree-preserved-branch-cleanup'

describe('preserved branch cleanup RPC method', () => {
  it('releases exact cleanup routes through the runtime server', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      releasePreservedBranchCleanups: vi.fn().mockReturnValue({ released: 1 })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: [WORKTREE_PRESERVED_BRANCH_CLEANUP_METHOD]
    })
    const cleanups = [
      {
        worktree: 'id:repo-1::/workspace/feature',
        branchName: 'feature/test',
        expectedHead: 'abc123',
        hostId: 'ssh:target'
      }
    ]
    const request: RpcRequest = {
      id: 'req-1',
      authToken: 'tok',
      method: 'worktree.releasePreservedBranchCleanups',
      params: { cleanups }
    }

    const response = await dispatcher.dispatch(request)

    expect(runtime.releasePreservedBranchCleanups).toHaveBeenCalledWith(cleanups)
    expect(response).toMatchObject({ ok: true, result: { released: 1 } })
  })
})
