import type { GitCapabilityCache } from '../shared/git-capability-cache'
import {
  decodePreservedBranchCleanupProvenance,
  preservedBranchCleanupConfigKey,
  serializePreservedBranchCleanupProvenance
} from '../shared/preserved-branch-cleanup-provenance'
import type { GitPushTarget, RemoveWorktreeResult } from '../shared/types'
import type { GitExec } from './git-handler-ops'
import {
  removeResolvedWorktreeOp,
  resolveRelayWorktreeRemovalTarget
} from './git-handler-worktree-remove'

export type PreparedPreservedWorktreeRemoval = {
  preparedBranchName?: string
}

function normalizeBranchName(branch: string | undefined): string {
  return branch?.replace(/^refs\/heads\//, '') ?? ''
}

function isMissingConfigValue(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === 1 || code === 5 || code === '1' || code === '5'
}

async function clearPreparedBranch(
  git: GitExec,
  repoPath: string,
  branchName: string,
  identity: { worktreeId: string; worktreeInstanceId: string }
): Promise<void> {
  const key = preservedBranchCleanupConfigKey(branchName)
  let serialized: string
  try {
    serialized = (await git(['config', '--local', '--get', key], repoPath)).stdout.trim()
  } catch (error) {
    if (isMissingConfigValue(error)) {
      return
    }
    throw error
  }
  let provenance
  try {
    provenance = decodePreservedBranchCleanupProvenance(serialized)
  } catch {
    return
  }
  if (
    provenance.branchName !== branchName ||
    provenance.worktreeId !== identity.worktreeId ||
    provenance.worktreeInstanceId !== identity.worktreeInstanceId
  ) {
    return
  }
  try {
    await git(['config', '--local', '--unset-all', key], repoPath)
  } catch (error) {
    if (!isMissingConfigValue(error)) {
      throw error
    }
  }
}

function parseIdentity(params: Record<string, unknown>): {
  worktreeId: string
  worktreeInstanceId: string
} {
  const worktreeId = params.worktreeId
  const worktreeInstanceId = params.worktreeInstanceId
  if (
    typeof worktreeId !== 'string' ||
    !worktreeId ||
    worktreeId.includes('\0') ||
    typeof worktreeInstanceId !== 'string' ||
    !worktreeInstanceId ||
    worktreeInstanceId.includes('\0')
  ) {
    throw new Error('Invalid preserved worktree removal identity.')
  }
  return { worktreeId, worktreeInstanceId }
}

async function writeAndAttestAuthority(
  git: GitExec,
  repoPath: string,
  branchName: string,
  expectedHead: string,
  params: Record<string, unknown>
): Promise<void> {
  const key = preservedBranchCleanupConfigKey(branchName)
  const serialized = serializePreservedBranchCleanupProvenance(
    expectedHead,
    params.pushTarget as GitPushTarget | undefined,
    { branchName, ...parseIdentity(params) }
  )
  await git(['config', '--local', '--replace-all', key, serialized], repoPath)
  const { stdout } = await git(['config', '--local', '--get', key], repoPath)
  if (stdout.trim() !== serialized) {
    throw new Error('Failed to attest preserved branch cleanup authority.')
  }
}

export async function removeWorktreeWithPreservedBranchCleanup(
  git: GitExec,
  params: Record<string, unknown>,
  capabilities: GitCapabilityCache
): Promise<RemoveWorktreeResult | PreparedPreservedWorktreeRemoval> {
  const identity = parseIdentity(params)
  const target = await resolveRelayWorktreeRemovalTarget(git, params, capabilities)
  const branchName = normalizeBranchName(target.worktree?.branch)
  const expectedHead = target.worktree?.head ?? ''
  if (params.deleteBranch !== false && branchName && expectedHead) {
    await writeAndAttestAuthority(git, target.repoPath, branchName, expectedHead, params)
  }
  if (params.prepare === true) {
    return branchName ? { preparedBranchName: branchName } : {}
  }

  const preparedBranchName =
    typeof params.preparedBranchName === 'string' ? params.preparedBranchName : ''
  if (preparedBranchName && preparedBranchName !== branchName) {
    await clearPreparedBranch(git, target.repoPath, preparedBranchName, identity)
  }
  return removeResolvedWorktreeOp(git, params, capabilities, target)
}
