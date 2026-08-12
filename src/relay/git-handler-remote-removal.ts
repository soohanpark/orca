import { iterateProcessOutputLines } from '../shared/process-output-field-scanner'
import type { GitExec } from './git-handler-ops'

function isMissingConfig(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === 1 || code === 5 || code === '1' || code === '5'
}

async function readBranchRemoteConfig(git: GitExec, repoPath: string): Promise<string> {
  try {
    return (await git(['config', '--get-regexp', '^branch\\..*\\.(remote|pushRemote)$'], repoPath))
      .stdout
  } catch (error) {
    if (isMissingConfig(error)) {
      return ''
    }
    throw error
  }
}

function branchUsesRemote(config: string, remoteName: string, remoteUrl: string): boolean {
  for (const line of iterateProcessOutputLines(config)) {
    const separator = line.search(/\s/)
    const value = separator < 0 ? '' : line.slice(separator + 1).trim()
    if (value === remoteName || value === remoteUrl) {
      return true
    }
  }
  return false
}

async function readClaimedRemoteUrl(
  git: GitExec,
  repoPath: string,
  claimedSection: string
): Promise<string> {
  return (
    await git(['config', '--local', '--get', `${claimedSection}.url`], repoPath)
  ).stdout.trim()
}

async function deleteRemoteTrackingRefs(
  git: GitExec,
  repoPath: string,
  remoteName: string
): Promise<void> {
  const { stdout } = await git(
    ['for-each-ref', '--format=%(refname)', `refs/remotes/${remoteName}/`],
    repoPath
  )
  const refs = [...iterateProcessOutputLines(stdout)].filter(Boolean)
  if (!refs.length) {
    return
  }
  await git(['update-ref', '--stdin'], repoPath, {
    stdin: refs.map((ref) => `delete ${ref}\n`).join('')
  })
}

export async function removeRelayRemoteIfMatches(
  git: GitExec,
  params: Record<string, unknown>
): Promise<void> {
  const repoPath = params.repoPath
  const remoteName = params.remoteName
  const expectedRemoteUrl = params.expectedRemoteUrl
  if (
    typeof repoPath !== 'string' ||
    !repoPath ||
    repoPath.includes('\0') ||
    typeof remoteName !== 'string' ||
    !remoteName ||
    remoteName.includes('\0') ||
    remoteName === 'origin' ||
    remoteName === 'upstream' ||
    typeof expectedRemoteUrl !== 'string' ||
    !expectedRemoteUrl ||
    expectedRemoteUrl.includes('\0')
  ) {
    throw new Error('Invalid remote cleanup request.')
  }

  await git(['check-ref-format', `refs/remotes/${remoteName}/orca-validation`], repoPath)
  const claimedSection = `orca-preserved-remote.${remoteName}`
  await git(
    ['config', '--local', '--rename-section', `remote.${remoteName}`, claimedSection],
    repoPath
  )
  let claimActive = true
  try {
    const configuredRemoteUrl = await readClaimedRemoteUrl(git, repoPath, claimedSection)
    if (configuredRemoteUrl !== expectedRemoteUrl) {
      throw new Error(`Refusing to remove changed remote "${remoteName}".`)
    }

    const branchConfig = await readBranchRemoteConfig(git, repoPath)
    if (branchUsesRemote(branchConfig, remoteName, expectedRemoteUrl)) {
      throw new Error(`Refusing to remove remote "${remoteName}" while a branch uses it.`)
    }

    await deleteRemoteTrackingRefs(git, repoPath, remoteName)
    await git(['config', '--local', '--remove-section', claimedSection], repoPath)
    claimActive = false
  } catch (error) {
    if (claimActive) {
      try {
        await git(
          ['config', '--local', '--rename-section', claimedSection, `remote.${remoteName}`],
          repoPath
        )
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Failed to restore remote "${remoteName}".`
        )
      }
    }
    throw error
  }
}
