import { beforeEach, describe, expect, it, vi } from 'vitest'

const { successToastMock, warningToastMock, infoToastMock, getStateMock } = vi.hoisted(() => ({
  successToastMock: vi.fn(),
  warningToastMock: vi.fn(),
  infoToastMock: vi.fn(),
  getStateMock: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: { success: successToastMock, warning: warningToastMock, info: infoToastMock }
}))

vi.mock('@/store', () => ({
  useAppStore: { getState: getStateMock }
}))

import type { BrowserCookieImportSummary } from '../../../shared/types'
import { emitBrowserCookieImportToast } from './browser-cookie-import-toast'

const summary: BrowserCookieImportSummary = {
  totalCookies: 3,
  importedCookies: 3,
  skippedCookies: 0,
  domains: ['example.com']
}

describe('emitBrowserCookieImportToast', () => {
  beforeEach(() => {
    successToastMock.mockReset()
    warningToastMock.mockReset()
    infoToastMock.mockReset()
    getStateMock.mockReset()
  })

  it('shows the localized total-failure warning', () => {
    emitBrowserCookieImportToast(
      {
        ...summary,
        warning: {
          code: 'restart-fallback-unavailable',
          loadedCookies: 0,
          failedCookies: 3
        }
      },
      'Imported 3 cookies.'
    )

    expect(warningToastMock).toHaveBeenCalledWith(
      'None of the 3 cookies could be loaded, and the restart fallback was unavailable. The previous cookies for this profile were replaced. Try the import again.'
    )
    expect(successToastMock).not.toHaveBeenCalled()
  })

  it('shows the localized partial-failure warning', () => {
    emitBrowserCookieImportToast(
      {
        ...summary,
        warning: {
          code: 'restart-fallback-unavailable',
          loadedCookies: 2,
          failedCookies: 1
        }
      },
      'Imported 3 cookies.'
    )

    expect(warningToastMock).toHaveBeenCalledWith(
      'Imported 2 of 3 cookies. The rest could not be loaded, and the restart fallback was unavailable. Try the import again.'
    )
    expect(successToastMock).not.toHaveBeenCalled()
  })

  it('shows success when the import has no warning', () => {
    emitBrowserCookieImportToast(summary, 'Imported 3 cookies.')

    expect(successToastMock).toHaveBeenCalledWith('Imported 3 cookies.')
    expect(warningToastMock).not.toHaveBeenCalled()
    expect(infoToastMock).not.toHaveBeenCalled()
  })

  it('adds the Google direct sign-in notice when the snapshot contained Google cookies', () => {
    emitBrowserCookieImportToast({ ...summary, googleCookiesPresent: true }, 'Imported 3 cookies.')

    expect(successToastMock).toHaveBeenCalledWith('Imported 3 cookies.')
    expect(infoToastMock).toHaveBeenCalledTimes(1)
    expect(infoToastMock.mock.calls[0][0]).toBe(
      "Google can't stay signed in with imported cookies. Sign in once in a browser tab to keep your Google session."
    )
    expect(infoToastMock.mock.calls[0][1].action.label).toBe('Sign in to Google')
  })

  it('shows the Google notice alongside a degraded-import warning', () => {
    emitBrowserCookieImportToast(
      {
        ...summary,
        googleCookiesPresent: true,
        warning: {
          code: 'restart-fallback-unavailable',
          loadedCookies: 2,
          failedCookies: 1
        }
      },
      'Imported 3 cookies.'
    )

    expect(warningToastMock).toHaveBeenCalledTimes(1)
    expect(infoToastMock).toHaveBeenCalledTimes(1)
  })

  it('opens accounts.google.com in a browser tab from the notice action', () => {
    const closeSettingsPage = vi.fn()
    const createBrowserTab = vi.fn()
    getStateMock.mockReturnValue({
      activeWorktreeId: 'wt-1',
      closeSettingsPage,
      createBrowserTab
    })

    emitBrowserCookieImportToast({ ...summary, googleCookiesPresent: true }, 'Imported 3 cookies.')
    infoToastMock.mock.calls[0][1].action.onClick()

    expect(closeSettingsPage).toHaveBeenCalledTimes(1)
    expect(createBrowserTab).toHaveBeenCalledWith('wt-1', 'https://accounts.google.com/', {
      activate: true
    })
  })

  it('does not open a tab when no worktree is active', () => {
    const createBrowserTab = vi.fn()
    getStateMock.mockReturnValue({
      activeWorktreeId: null,
      closeSettingsPage: vi.fn(),
      createBrowserTab
    })

    emitBrowserCookieImportToast({ ...summary, googleCookiesPresent: true }, 'Imported 3 cookies.')
    infoToastMock.mock.calls[0][1].action.onClick()

    expect(createBrowserTab).not.toHaveBeenCalled()
  })
})
