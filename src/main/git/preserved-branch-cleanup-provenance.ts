import type { GitPushTarget, RemoveWorktreeResult } from '../../shared/types'
import {
  decodePreservedBranchCleanupProvenance,
  parsePreservedBranchCleanupProvenance,
  preservedBranchCleanupConfigKey,
  serializePreservedBranchCleanupProvenance
} from '../../shared/preserved-branch-cleanup-provenance'
import { iterateProcessOutputLines } from '../../shared/process-output-field-scanner'

export type PreservedBranchCleanupGitExec = (
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string }>

export async function rememberPreservedBranchCleanupProvenance(
  execGit: PreservedBranchCleanupGitExec,
  repoPath: string,
  branchName: string,
  expectedHead: string,
  pushTarget?: GitPushTarget,
  worktreeId?: string,
  worktreeInstanceId?: string
): Promise<void> {
  await execGit(
    [
      'config',
      '--local',
      '--replace-all',
      preservedBranchCleanupConfigKey(branchName),
      serializePreservedBranchCleanupProvenance(
        expectedHead,
        pushTarget,
        worktreeId ? { branchName, worktreeId, worktreeInstanceId } : undefined
      )
    ],
    repoPath
  )
}

export async function recoverPreservedBranchCleanupProvenance(
  execGit: PreservedBranchCleanupGitExec,
  repoPath: string,
  identity: { worktreeId: string; worktreeInstanceId: string }
): Promise<{
  branchName: string
  expectedHead: string
  pushTarget?: GitPushTarget
} | null> {
  let stdout: string
  try {
    ;({ stdout } = await execGit(
      ['config', '--local', '--get-regexp', '^branch\\..*\\.orca-preserved-cleanup$'],
      repoPath
    ))
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    if (code === 1 || code === 5 || code === '1' || code === '5') {
      return null
    }
    throw error
  }

  let recovered: ReturnType<typeof decodePreservedBranchCleanupProvenance> | undefined
  for (const line of iterateProcessOutputLines(stdout)) {
    const separator = line.search(/\s/)
    if (separator < 0) {
      continue
    }
    let candidate: ReturnType<typeof decodePreservedBranchCleanupProvenance>
    try {
      candidate = decodePreservedBranchCleanupProvenance(line.slice(separator + 1).trimStart())
    } catch {
      continue
    }
    if (
      candidate.worktreeId !== identity.worktreeId ||
      candidate.worktreeInstanceId !== identity.worktreeInstanceId
    ) {
      continue
    }
    if (recovered) {
      throw new Error(`Ambiguous preserved branch cleanup is pending for "${identity.worktreeId}".`)
    }
    recovered = candidate
  }
  if (!recovered?.branchName) {
    return null
  }
  return {
    branchName: recovered.branchName,
    expectedHead: recovered.expectedHead,
    ...(recovered.pushTarget ? { pushTarget: recovered.pushTarget } : {})
  }
}

export async function clearPreservedBranchCleanupProvenance(
  execGit: PreservedBranchCleanupGitExec,
  repoPath: string,
  branchName: string
): Promise<void> {
  try {
    await execGit(
      ['config', '--local', '--unset-all', preservedBranchCleanupConfigKey(branchName)],
      repoPath
    )
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    if (code !== 1 && code !== 5 && code !== '1' && code !== '5') {
      throw error
    }
  }
}

export async function resolvePreservedBranchCleanupProvenance(
  execGit: PreservedBranchCleanupGitExec,
  repoPath: string,
  branchName: string,
  expectedHead: string
): Promise<GitPushTarget | undefined> {
  try {
    const { stdout } = await execGit(
      ['config', '--local', '--get', preservedBranchCleanupConfigKey(branchName)],
      repoPath
    )
    return parsePreservedBranchCleanupProvenance(stdout.trim(), expectedHead)
  } catch {
    throw new Error(`No preserved branch cleanup is pending for "${branchName}".`)
  }
}

type RemoveWithPreservedBranchCleanupProvenanceOptions = {
  branchName: string | undefined
  expectedHead: string | undefined
  pushTarget?: GitPushTarget
  remember: (branchName: string, expectedHead: string, pushTarget?: GitPushTarget) => Promise<void>
  clear: (branchName: string) => Promise<void>
  remove: () => Promise<RemoveWorktreeResult | undefined>
}

async function clearAfterCompletedRemoval(
  clear: (branchName: string) => Promise<void>,
  branchName: string
): Promise<void> {
  try {
    await clear(branchName)
  } catch (error) {
    // Why: cleanup metadata must not turn an already-completed worktree removal into a false failure.
    console.warn(
      `[git] Failed to clear preserved branch cleanup provenance for "${branchName}"`,
      error
    )
  }
}

export async function removeWithPreservedBranchCleanupProvenance(
  options: RemoveWithPreservedBranchCleanupProvenanceOptions
): Promise<RemoveWorktreeResult> {
  const branchName = options.branchName?.replace(/^refs\/heads\//, '')
  if (!branchName) {
    return (await options.remove()) ?? {}
  }
  if (!options.expectedHead) {
    throw new Error(
      `Cannot safely remove branch "${branchName}" without preserving its saved commit.`
    )
  }

  await options.remember(branchName, options.expectedHead, options.pushTarget)
  // Why: do not clear on rejection; a timed-out remote removal may finish after response loss.
  const result = (await options.remove()) ?? {}

  if (!result.preservedBranch) {
    await clearAfterCompletedRemoval(options.clear, branchName)
    return result
  }
  return {
    ...result,
    preservedBranch: {
      ...result.preservedBranch,
      head: result.preservedBranch.head ?? options.expectedHead
    }
  }
}
