import type { GitPushTarget } from '../../shared/types'

export type PreservedBranchCleanupGitExec = (
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string }>

function branchConfigKey(branchName: string, name: string): string {
  return `branch.${branchName}.${name}`
}

function remoteConfigKey(remoteName: string, name: string): string {
  return `remote.${remoteName}.${name}`
}

async function readConfig(
  execGit: PreservedBranchCleanupGitExec,
  repoPath: string,
  key: string
): Promise<string | null> {
  try {
    const { stdout } = await execGit(['config', '--local', '--get', key], repoPath)
    const value = stdout.trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

export async function rememberPreservedBranchCleanupProvenance(
  execGit: PreservedBranchCleanupGitExec,
  repoPath: string,
  branchName: string,
  expectedHead: string,
  pushTarget?: GitPushTarget
): Promise<void> {
  await execGit(
    [
      'config',
      '--local',
      '--replace-all',
      branchConfigKey(branchName, 'orca-preserved-head'),
      expectedHead
    ],
    repoPath
  )
  if (pushTarget?.remoteCreated && pushTarget.remoteUrl) {
    await execGit(
      [
        'config',
        '--local',
        '--replace-all',
        remoteConfigKey(pushTarget.remoteName, 'orca-created-url'),
        pushTarget.remoteUrl
      ],
      repoPath
    )
  }
}

export async function resolvePreservedBranchCleanupProvenance(
  execGit: PreservedBranchCleanupGitExec,
  repoPath: string,
  branchName: string,
  expectedHead: string
): Promise<GitPushTarget | undefined> {
  const preservedHead = await readConfig(
    execGit,
    repoPath,
    branchConfigKey(branchName, 'orca-preserved-head')
  )
  if (preservedHead !== expectedHead) {
    throw new Error(`No preserved branch cleanup is pending for "${branchName}".`)
  }

  const remoteName = await readConfig(execGit, repoPath, branchConfigKey(branchName, 'remote'))
  const mergeRef = await readConfig(execGit, repoPath, branchConfigKey(branchName, 'merge'))
  if (!remoteName || !mergeRef?.startsWith('refs/heads/')) {
    return undefined
  }
  const targetBranchName = mergeRef.slice('refs/heads/'.length)
  if (!targetBranchName) {
    return undefined
  }

  const createdRemoteUrl = await readConfig(
    execGit,
    repoPath,
    remoteConfigKey(remoteName, 'orca-created-url')
  )
  let configuredRemoteUrl: string | null = null
  try {
    configuredRemoteUrl = (await execGit(['remote', 'get-url', remoteName], repoPath)).stdout.trim()
  } catch {
    // A missing remote cannot be cleaned up, but branch deletion remains safe.
  }
  return {
    remoteName,
    branchName: targetBranchName,
    ...((createdRemoteUrl ?? configuredRemoteUrl)
      ? { remoteUrl: createdRemoteUrl ?? configuredRemoteUrl ?? undefined }
      : {}),
    ...(createdRemoteUrl ? { remoteCreated: true } : {})
  }
}
