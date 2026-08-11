import type { GitPushTarget } from './types'

type PreservedBranchCleanupProvenance = {
  version: 1
  expectedHead: string
  pushTarget?: GitPushTarget
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
  pushTarget?: GitPushTarget
): string {
  if (!expectedHead) {
    throw new Error('Invalid preserved branch cleanup provenance.')
  }
  return JSON.stringify({
    version: 1,
    expectedHead,
    ...(pushTarget ? { pushTarget: parsePushTarget(pushTarget) } : {})
  } satisfies PreservedBranchCleanupProvenance)
}

export function parsePreservedBranchCleanupProvenance(
  serialized: string,
  expectedHead: string
): GitPushTarget | undefined {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('Invalid preserved branch cleanup provenance.')
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['version', 'expectedHead', 'pushTarget']) ||
    value.version !== 1 ||
    typeof value.expectedHead !== 'string' ||
    value.expectedHead !== expectedHead
  ) {
    throw new Error('Invalid preserved branch cleanup provenance.')
  }
  return parsePushTarget(value.pushTarget)
}
