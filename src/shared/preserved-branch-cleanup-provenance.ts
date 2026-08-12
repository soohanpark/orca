import type { GitPushTarget } from './types'

export type PreservedBranchCleanupProvenance = {
  version: 1
  expectedHead: string
  pushTarget?: GitPushTarget
  branchName?: string
  worktreeId?: string
  worktreeInstanceId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function parsePushTarget(value: unknown): GitPushTarget | undefined {
  if (value === undefined) {
    return undefined
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['remoteName', 'branchName', 'remoteUrl', 'remoteCreated']) ||
    typeof value.remoteName !== 'string' ||
    value.remoteName.length === 0 ||
    typeof value.branchName !== 'string' ||
    value.branchName.length === 0 ||
    (value.remoteUrl !== undefined &&
      (typeof value.remoteUrl !== 'string' || value.remoteUrl.length === 0)) ||
    (value.remoteCreated !== undefined && typeof value.remoteCreated !== 'boolean')
  ) {
    throw new Error('Invalid preserved branch cleanup provenance.')
  }
  return {
    remoteName: value.remoteName,
    branchName: value.branchName,
    ...(value.remoteUrl !== undefined ? { remoteUrl: value.remoteUrl } : {}),
    ...(value.remoteCreated !== undefined ? { remoteCreated: value.remoteCreated } : {})
  }
}

export function preservedBranchCleanupConfigKey(branchName: string): string {
  return `branch.${branchName}.orca-preserved-cleanup`
}

export function serializePreservedBranchCleanupProvenance(
  expectedHead: string,
  pushTarget?: GitPushTarget,
  identity?: { branchName: string; worktreeId: string; worktreeInstanceId?: string }
): string {
  if (
    !expectedHead ||
    (identity !== undefined &&
      (!identity.branchName ||
        !identity.worktreeId ||
        (identity.worktreeInstanceId !== undefined && !identity.worktreeInstanceId)))
  ) {
    throw new Error('Invalid preserved branch cleanup provenance.')
  }
  return JSON.stringify({
    version: 1,
    expectedHead,
    ...(pushTarget ? { pushTarget: parsePushTarget(pushTarget) } : {}),
    ...(identity ? identity : {})
  } satisfies PreservedBranchCleanupProvenance)
}

export function decodePreservedBranchCleanupProvenance(
  serialized: string
): PreservedBranchCleanupProvenance {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('Invalid preserved branch cleanup provenance.')
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'version',
      'expectedHead',
      'pushTarget',
      'branchName',
      'worktreeId',
      'worktreeInstanceId'
    ]) ||
    value.version !== 1 ||
    typeof value.expectedHead !== 'string' ||
    !value.expectedHead ||
    (value.branchName !== undefined &&
      (typeof value.branchName !== 'string' || !value.branchName)) ||
    (value.worktreeId !== undefined &&
      (typeof value.worktreeId !== 'string' || !value.worktreeId)) ||
    (value.worktreeInstanceId !== undefined &&
      (typeof value.worktreeInstanceId !== 'string' || !value.worktreeInstanceId))
  ) {
    throw new Error('Invalid preserved branch cleanup provenance.')
  }
  return {
    version: 1,
    expectedHead: value.expectedHead,
    ...(value.pushTarget !== undefined ? { pushTarget: parsePushTarget(value.pushTarget) } : {}),
    ...(value.branchName !== undefined ? { branchName: value.branchName } : {}),
    ...(value.worktreeId !== undefined ? { worktreeId: value.worktreeId } : {}),
    ...(value.worktreeInstanceId !== undefined
      ? { worktreeInstanceId: value.worktreeInstanceId }
      : {})
  }
}

export function parsePreservedBranchCleanupProvenance(
  serialized: string,
  expectedHead: string
): GitPushTarget | undefined {
  const value = decodePreservedBranchCleanupProvenance(serialized)
  if (value.expectedHead !== expectedHead) {
    throw new Error('Invalid preserved branch cleanup provenance.')
  }
  return value.pushTarget
}
