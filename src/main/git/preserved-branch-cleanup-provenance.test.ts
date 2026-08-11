import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPreservedBranchCleanupProvenance,
  rememberPreservedBranchCleanupProvenance,
  recoverPreservedBranchCleanupProvenance,
  removeWithPreservedBranchCleanupProvenance,
  resolvePreservedBranchCleanupProvenance,
  type PreservedBranchCleanupGitExec
} from './preserved-branch-cleanup-provenance'
import { preservedBranchCleanupConfigKey } from '../../shared/preserved-branch-cleanup-provenance'

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
    await execGit(['config', 'branch.feature/test.remote', 'origin'], path)
    await execGit(['config', 'branch.feature/test.merge', 'refs/heads/changed'], path)
    await execGit(['remote', 'remove', 'contributor'], path)

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

  it('uses one branch-scoped value without creating phantom remotes', async () => {
    const { execGit, path } = await createRepo()
    await execGit(['remote', 'add', 'contributor', 'https://github.com/user/repo.git'], path)
    const head = (await execGit(['rev-parse', 'feature/test'], path)).stdout.trim()
    await rememberPreservedBranchCleanupProvenance(execGit, path, 'feature/test', head, {
      remoteName: 'contributor',
      branchName: 'user/fix',
      remoteUrl: 'https://github.com/user/repo.git',
      remoteCreated: true
    })
    await execGit(['remote', 'remove', 'contributor'], path)

    expect((await execGit(['remote'], path)).stdout.trim()).toBe('')
    expect(
      (
        await execGit(
          ['config', '--get-all', preservedBranchCleanupConfigKey('feature/test')],
          path
        )
      ).stdout
        .trim()
        .split(/\r?\n/)
    ).toHaveLength(1)
  })

  it('fails closed when branch-scoped authority is missing', async () => {
    const { execGit, path } = await createRepo()
    const head = (await execGit(['rev-parse', 'feature/test'], path)).stdout.trim()

    await expect(
      resolvePreservedBranchCleanupProvenance(execGit, path, 'feature/test', head)
    ).rejects.toThrow('No preserved branch cleanup is pending')
  })

  it('fails closed for malformed serialized provenance with one targeted read', async () => {
    const execGit = vi.fn<PreservedBranchCleanupGitExec>().mockResolvedValue({
      stdout: '{"version":1,"expectedHead":"head","pushTarget":{"remoteName":7}}\n',
      stderr: ''
    })

    await expect(
      resolvePreservedBranchCleanupProvenance(execGit, '/repo', 'feature/test', 'head')
    ).rejects.toThrow('No preserved branch cleanup is pending')
    expect(execGit).toHaveBeenCalledTimes(1)
    expect(execGit).toHaveBeenCalledWith(
      ['config', '--local', '--get', preservedBranchCleanupConfigKey('feature/test')],
      '/repo'
    )
  })

  it('recovers exact authority by worktree only on the missing-path error path', async () => {
    const { execGit, path } = await createRepo()
    const head = (await execGit(['rev-parse', 'feature/test'], path)).stdout.trim()
    await rememberPreservedBranchCleanupProvenance(
      execGit,
      path,
      'feature/test',
      head,
      undefined,
      'repo-1::/missing/wt'
    )

    await expect(
      recoverPreservedBranchCleanupProvenance(execGit, path, 'repo-1::/missing/wt')
    ).resolves.toEqual({ branchName: 'feature/test', expectedHead: head })
  })

  it('writes authority before removal and performs no removal when the write fails', async () => {
    const order: string[] = []
    const remember = vi.fn(async () => {
      order.push('remember')
      throw new Error('config locked')
    })
    const remove = vi.fn(async () => {
      order.push('remove')
      return {}
    })

    await expect(
      removeWithPreservedBranchCleanupProvenance({
        branchName: 'feature/test',
        expectedHead: 'head',
        remember,
        clear: vi.fn(),
        remove
      })
    ).rejects.toThrow('config locked')
    expect(order).toEqual(['remember'])
    expect(remove).not.toHaveBeenCalled()
  })

  it('does not report a false failure when completed-removal cleanup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(
        removeWithPreservedBranchCleanupProvenance({
          branchName: 'feature/test',
          expectedHead: 'head',
          remember: vi.fn().mockResolvedValue(undefined),
          clear: vi.fn().mockRejectedValue(new Error('config locked')),
          remove: vi.fn().mockResolvedValue({})
        })
      ).resolves.toEqual({})
    } finally {
      warn.mockRestore()
    }
  })

  it('retains authority when removal completion is unknown', async () => {
    const clear = vi.fn()
    await expect(
      removeWithPreservedBranchCleanupProvenance({
        branchName: 'feature/test',
        expectedHead: 'head',
        remember: vi.fn().mockResolvedValue(undefined),
        clear,
        remove: vi.fn().mockRejectedValue(new Error('response lost'))
      })
    ).rejects.toThrow('response lost')
    expect(clear).not.toHaveBeenCalled()
  })

  it('clears branch-scoped provenance explicitly', async () => {
    const { execGit, path } = await createRepo()
    const head = (await execGit(['rev-parse', 'feature/test'], path)).stdout.trim()
    await rememberPreservedBranchCleanupProvenance(execGit, path, 'feature/test', head)

    await clearPreservedBranchCleanupProvenance(execGit, path, 'feature/test')

    await expect(
      resolvePreservedBranchCleanupProvenance(execGit, path, 'feature/test', head)
    ).rejects.toThrow('No preserved branch cleanup is pending')
  })
})
