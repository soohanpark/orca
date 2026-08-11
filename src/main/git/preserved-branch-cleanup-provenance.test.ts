import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  rememberPreservedBranchCleanupProvenance,
  resolvePreservedBranchCleanupProvenance,
  type PreservedBranchCleanupGitExec
} from './preserved-branch-cleanup-provenance'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function createRepo(): Promise<{ execGit: PreservedBranchCleanupGitExec; path: string }> {
  const path = await mkdtemp(join(tmpdir(), 'orca-preserved-cleanup-'))
  tempDirs.push(path)
  const execGit: PreservedBranchCleanupGitExec = async (args, cwd) => {
    const result = await execFileAsync('git', args, { cwd })
    return { stdout: result.stdout, stderr: result.stderr }
  }
  await execGit(['init'], path)
  await execGit(['config', 'user.email', 'test@example.com'], path)
  await execGit(['config', 'user.name', 'Test'], path)
  await execGit(['commit', '--allow-empty', '-m', 'initial'], path)
  await execGit(['branch', 'feature/test'], path)
  return { execGit, path }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('preserved branch cleanup provenance', () => {
  it('reconstructs exact branch and Orca-created remote provenance', async () => {
    const { execGit, path } = await createRepo()
    const head = (await execGit(['rev-parse', 'feature/test'], path)).stdout.trim()
    await execGit(['remote', 'add', 'contributor', 'https://github.com/user/repo.git'], path)
    await execGit(['config', 'branch.feature/test.remote', 'contributor'], path)
    await execGit(['config', 'branch.feature/test.merge', 'refs/heads/user/fix'], path)

    await rememberPreservedBranchCleanupProvenance(execGit, path, 'feature/test', head, {
      remoteName: 'contributor',
      branchName: 'user/fix',
      remoteUrl: 'https://github.com/user/repo.git',
      remoteCreated: true
    })

    await expect(
      resolvePreservedBranchCleanupProvenance(execGit, path, 'feature/test', head)
    ).resolves.toEqual({
      remoteName: 'contributor',
      branchName: 'user/fix',
      remoteUrl: 'https://github.com/user/repo.git',
      remoteCreated: true
    })
  })

  it('fails closed for a branch without the exact preserved head', async () => {
    const { execGit, path } = await createRepo()
    const head = (await execGit(['rev-parse', 'feature/test'], path)).stdout.trim()
    await rememberPreservedBranchCleanupProvenance(execGit, path, 'feature/test', head)

    await expect(
      resolvePreservedBranchCleanupProvenance(execGit, path, 'feature/test', 'different-head')
    ).rejects.toThrow('No preserved branch cleanup is pending')
  })

  it('lets Git remove branch-scoped cleanup provenance with the branch', async () => {
    const { execGit, path } = await createRepo()
    const head = (await execGit(['rev-parse', 'feature/test'], path)).stdout.trim()
    await rememberPreservedBranchCleanupProvenance(execGit, path, 'feature/test', head)

    await execGit(['branch', '-D', 'feature/test'], path)

    await expect(
      resolvePreservedBranchCleanupProvenance(execGit, path, 'feature/test', head)
    ).rejects.toThrow('No preserved branch cleanup is pending')
  })

  it('keeps Orca-created ownership bounded to one marker per remote', async () => {
    const { execGit, path } = await createRepo()
    await execGit(['branch', 'feature/second'], path)
    await execGit(['remote', 'add', 'contributor', 'https://github.com/user/repo.git'], path)
    for (const branchName of ['feature/test', 'feature/second']) {
      const head = (await execGit(['rev-parse', branchName], path)).stdout.trim()
      await execGit(['config', `branch.${branchName}.remote`, 'contributor'], path)
      await execGit(['config', `branch.${branchName}.merge`, `refs/heads/${branchName}`], path)
      await rememberPreservedBranchCleanupProvenance(execGit, path, branchName, head, {
        remoteName: 'contributor',
        branchName,
        remoteUrl: 'https://github.com/user/repo.git',
        remoteCreated: true
      })
    }

    await expect(
      execGit(['config', '--get-all', 'remote.contributor.orca-created-url'], path)
    ).resolves.toMatchObject({ stdout: 'https://github.com/user/repo.git\n' })
  })

  it('fails closed when branch-scoped authority is missing', async () => {
    const { execGit, path } = await createRepo()
    const head = (await execGit(['rev-parse', 'feature/test'], path)).stdout.trim()

    await expect(
      resolvePreservedBranchCleanupProvenance(execGit, path, 'feature/test', head)
    ).rejects.toThrow('No preserved branch cleanup is pending')
  })
})
