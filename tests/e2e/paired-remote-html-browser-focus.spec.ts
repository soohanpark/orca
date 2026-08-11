import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const FIXTURE_NAME = 'paired-html-focus.html'

test('keeps a selected remote HTML browser tab focused after host adoption', async ({
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.setTimeout(240_000)
  writeFileSync(
    path.join(testRepoPath, FIXTURE_NAME),
    '<!doctype html><html><body><h1>paired html focus</h1></body></html>\n'
  )
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)

  const offer = await createRuntimeDesktopPairingOffer(orcaPage)
  let client: PairedElectronClient | null = null
  try {
    client = await launchPairedElectronClient(offer, testInfo, 'Remote HTML focus')
    const page = client.page
    const worktreeId = await expect
      .poll(
        () =>
          page.evaluate((repoPath) => {
            const state = window.__store?.getState()
            return state
              ? (state.allWorktrees().find((worktree) => worktree.path === repoPath)?.id ?? null)
              : null
          }, testRepoPath),
        { timeout: 60_000, message: 'paired client never received the host worktree' }
      )
      .not.toBeNull()
      .then(() =>
        page.evaluate((repoPath) => {
          const state = window.__store?.getState()
          return state?.allWorktrees().find((worktree) => worktree.path === repoPath)?.id ?? null
        }, testRepoPath)
      )
    if (!worktreeId) {
      throw new Error('paired client worktree disappeared after discovery')
    }
    await page.evaluate(
      ({ environmentId, worktreeId }) => {
        window.__store?.getState().setActiveWorktree(worktreeId, `runtime:${environmentId}`)
      },
      { environmentId: client.environmentId, worktreeId }
    )
    await openFileExplorer(page)
    const fixtureRow = page.locator('[data-file-explorer-row]').filter({ hasText: FIXTURE_NAME })
    await expect(fixtureRow).toBeVisible({ timeout: 30_000 })
    await fixtureRow.click({ button: 'right' })
    const openInBrowser = page.getByRole('menuitem', { name: 'Open in Orca Browser' })
    await expect(openInBrowser).toBeVisible()
    await openInBrowser.evaluate((element) => (element as HTMLElement).click())

    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ environmentId, fixtureName, worktreeId }) => {
              const state = window.__store?.getState()
              if (!state) {
                return null
              }
              const browser = (state.browserTabsByWorktree[worktreeId] ?? []).find((tab) =>
                tab.url.endsWith(`/${fixtureName}`)
              )
              const browserPage = browser
                ? (state.browserPagesByWorkspace[browser.id] ?? [])[0]
                : null
              const handle = browserPage
                ? state.remoteBrowserPageHandlesByPageId[browserPage.id]
                : null
              const response = await window.api.runtimeEnvironments.call({
                selector: environmentId,
                method: 'session.tabs.list',
                params: { worktree: `id:${worktreeId}` },
                timeoutMs: 15_000
              })
              const hostHasHtml =
                response.ok &&
                response.result.tabs.some(
                  (tab) => tab.type === 'browser' && tab.url.endsWith(`/${fixtureName}`)
                )
              const activeGroup = (state.groupsByWorktree[worktreeId] ?? []).find(
                (group) => group.id === state.activeGroupIdByWorktree[worktreeId]
              )
              const activeUnified = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
                (tab) => tab.id === activeGroup?.activeTabId
              )
              return {
                activeGroupType: activeUnified?.contentType ?? null,
                activeTabType: state.activeTabTypeByWorktree[worktreeId] ?? null,
                handleEnvironmentId: handle?.environmentId ?? null,
                hostHasHtml
              }
            },
            { environmentId: client!.environmentId, fixtureName: FIXTURE_NAME, worktreeId }
          ),
        { timeout: 60_000, message: 'remote HTML browser ownership never converged' }
      )
      .toEqual({
        activeGroupType: 'browser',
        activeTabType: 'browser',
        handleEnvironmentId: client.environmentId,
        hostHasHtml: true
      })
    await expect(page.getByTestId('remote-browser-frame')).toBeVisible({ timeout: 60_000 })

    const tabIds = await page.evaluate(
      ({ fixtureName, worktreeId: targetWorktreeId }) => {
        const state = window.__store?.getState()
        if (!state) {
          return null
        }
        const terminalId = state.tabsByWorktree[targetWorktreeId]?.[0]?.id ?? null
        const browserId = (state.browserTabsByWorktree[targetWorktreeId] ?? []).find((tab) =>
          tab.url.endsWith(`/${fixtureName}`)
        )?.id
        return terminalId && browserId ? { browserId, terminalId } : null
      },
      { fixtureName: FIXTURE_NAME, worktreeId }
    )
    if (!tabIds) {
      throw new Error('paired client did not retain both terminal and HTML browser tabs')
    }
    await page.locator(`[data-tab-id="${tabIds.terminalId}"]`).click()
    await expect
      .poll(
        () =>
          page.evaluate((targetWorktreeId) => {
            const state = window.__store?.getState()
            return state?.activeTabTypeByWorktree[targetWorktreeId] ?? null
          }, worktreeId),
        { message: 'terminal tab never became active before the browser click' }
      )
      .toBe('terminal')
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ environmentId, worktreeId }) => {
              const response = await window.api.runtimeEnvironments.call({
                selector: environmentId,
                method: 'session.tabs.list',
                params: { worktree: `id:${worktreeId}` },
                timeoutMs: 15_000
              })
              if (!response.ok) {
                return false
              }
              return (
                response.result.tabs.find((tab) => tab.id === response.result.activeTabId)?.type ===
                'terminal'
              )
            },
            { environmentId: client.environmentId, worktreeId }
          ),
        { timeout: 30_000, message: 'host never accepted terminal activation' }
      )
      .toBe(true)
    const hostBrowserTabId = await page.evaluate(
      async ({ environmentId, fixtureName, worktreeId }) => {
        const response = await window.api.runtimeEnvironments.call({
          selector: environmentId,
          method: 'session.tabs.list',
          params: { worktree: `id:${worktreeId}` },
          timeoutMs: 15_000
        })
        return response.ok
          ? (response.result.tabs.find(
              (tab) => tab.type === 'browser' && tab.url.endsWith(`/${fixtureName}`)
            )?.id ?? null)
          : null
      },
      { environmentId: client.environmentId, fixtureName: FIXTURE_NAME, worktreeId }
    )
    if (!hostBrowserTabId) {
      throw new Error('host HTML browser tab disappeared before activation')
    }
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ browserTabId, environmentId }) => {
              const state = window.__store?.getState()
              return (state?.browserPagesByWorkspace[browserTabId] ?? []).some((browserPage) => {
                const handle = state?.remoteBrowserPageHandlesByPageId[browserPage.id]
                return (
                  handle?.environmentId === environmentId ||
                  browserPage.browserRuntimeEnvironmentId === environmentId
                )
              })
            },
            { browserTabId: tabIds.browserId, environmentId: client.environmentId }
          ),
        { timeout: 30_000, message: 'client lost remote browser ownership before activation' }
      )
      .toBe(true)
    await page.locator(`[data-tab-id="${tabIds.browserId}"]`).click()

    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ environmentId, fixtureName, worktreeId }) => {
              const state = window.__store?.getState()
              if (!state) {
                return null
              }
              const response = await window.api.runtimeEnvironments.call({
                selector: environmentId,
                method: 'session.tabs.list',
                params: { worktree: `id:${worktreeId}` },
                timeoutMs: 15_000
              })
              const activeGroup = (state.groupsByWorktree[worktreeId] ?? []).find(
                (group) => group.id === state.activeGroupIdByWorktree[worktreeId]
              )
              const activeUnified = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
                (tab) => tab.id === activeGroup?.activeTabId
              )
              const hostActive = response.ok
                ? response.result.tabs.find((tab) => tab.id === response.result.activeTabId)
                : null
              return {
                activeGroupType: activeUnified?.contentType ?? null,
                activeTabType: state.activeTabTypeByWorktree[worktreeId] ?? null,
                hostActiveHtml:
                  hostActive?.type === 'browser' && hostActive.url.endsWith(`/${fixtureName}`)
              }
            },
            { environmentId: client!.environmentId, fixtureName: FIXTURE_NAME, worktreeId }
          ),
        { timeout: 30_000, message: 'browser click did not remain authoritative' }
      )
      .toEqual({ activeGroupType: 'browser', activeTabType: 'browser', hostActiveHtml: true })
    await expect(page.getByTestId('remote-browser-frame')).toBeVisible()
  } finally {
    await client?.dispose()
  }
})
