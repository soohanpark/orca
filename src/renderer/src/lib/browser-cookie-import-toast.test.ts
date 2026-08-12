import { beforeEach, describe, expect, it, vi } from 'vitest'

const { successToastMock, warningToastMock, errorToastMock, getStateMock } = vi.hoisted(() => ({
  successToastMock: vi.fn(),
  warningToastMock: vi.fn(),
  errorToastMock: vi.fn(),
  getStateMock: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    success: successToastMock,
    warning: warningToastMock,
    error: errorToastMock
  }
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
    errorToastMock.mockReset()
    getStateMock.mockReset()
    getStateMock.mockReturnValue({
      activeWorktreeId: 'worktree-1',
      closeSettingsPage: vi.fn(),
      openBrowserProfileTabInActiveWorkspace: vi.fn().mockResolvedValue(true)
    })
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
      'Imported 3 cookies.',
      'profile-1'
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
      'Imported 3 cookies.',
      'profile-1'
    )

    expect(warningToastMock).toHaveBeenCalledWith(
      'Imported 2 of 3 cookies. The rest could not be loaded, and the restart fallback was unavailable. Try the import again.'
    )
    expect(successToastMock).not.toHaveBeenCalled()
  })

  it('shows success when the import has no warning', () => {
    emitBrowserCookieImportToast(summary, 'Imported 3 cookies.', 'profile-1')

    expect(successToastMock).toHaveBeenCalledWith('Imported 3 cookies.')
    expect(warningToastMock).not.toHaveBeenCalled()
  })

  it('adds Google guidance to the import result when Google cookies were skipped', () => {
    emitBrowserCookieImportToast(
      { ...summary, googleCookiesSkipped: true },
      'Imported 3 cookies.',
      'profile-1'
    )

    expect(successToastMock).toHaveBeenCalledTimes(1)
    expect(successToastMock.mock.calls[0][0]).toBe('Imported 3 cookies.')
    expect(successToastMock.mock.calls[0][1].description).toBe(
      "Google wasn't imported. Sign in directly to use Google in this profile."
    )
    expect(successToastMock.mock.calls[0][1].action.label).toBe('Sign in to Google')
  })

  it('adds Google guidance to a degraded-import warning', () => {
    emitBrowserCookieImportToast(
      {
        ...summary,
        googleCookiesSkipped: true,
        warning: {
          code: 'restart-fallback-unavailable',
          loadedCookies: 2,
          failedCookies: 1
        }
      },
      'Imported 3 cookies.',
      'profile-1'
    )

    expect(warningToastMock).toHaveBeenCalledTimes(1)
    expect(warningToastMock.mock.calls[0][1].description).toBe(
      "Google wasn't imported. Sign in directly to use Google in this profile."
    )
  })

  it('opens accounts.google.com with the imported profile from the notice action', async () => {
    const closeSettingsPage = vi.fn()
    const openBrowserProfileTabInActiveWorkspace = vi.fn().mockResolvedValue(true)
    getStateMock.mockReturnValue({
      activeWorktreeId: 'worktree-1',
      closeSettingsPage,
      openBrowserProfileTabInActiveWorkspace
    })

    emitBrowserCookieImportToast(
      { ...summary, googleCookiesSkipped: true },
      'Imported 3 cookies.',
      'profile-1'
    )
    successToastMock.mock.calls[0][1].action.onClick()

    await vi.waitFor(() => expect(closeSettingsPage).toHaveBeenCalledTimes(1))
    expect(closeSettingsPage).toHaveBeenCalledTimes(1)
    expect(openBrowserProfileTabInActiveWorkspace).toHaveBeenCalledWith(
      'https://accounts.google.com/',
      'profile-1'
    )
  })

  it('keeps Settings open and reports failure when no workspace can host the sign-in tab', async () => {
    const closeSettingsPage = vi.fn()
    const openBrowserProfileTabInActiveWorkspace = vi.fn().mockResolvedValue(false)
    getStateMock.mockReturnValue({
      activeWorktreeId: 'worktree-1',
      closeSettingsPage,
      openBrowserProfileTabInActiveWorkspace
    })

    emitBrowserCookieImportToast(
      { ...summary, googleCookiesSkipped: true },
      'Imported 3 cookies.',
      'profile-1'
    )
    successToastMock.mock.calls[0][1].action.onClick()

    await vi.waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1))
    expect(errorToastMock).toHaveBeenCalledWith(
      'Could not open the browser profile. Open it and sign in at accounts.google.com.'
    )
    expect(closeSettingsPage).not.toHaveBeenCalled()
  })

  it('reports failure when opening the sign-in tab rejects', async () => {
    const closeSettingsPage = vi.fn()
    const openBrowserProfileTabInActiveWorkspace = vi
      .fn()
      .mockRejectedValue(new Error('runtime unavailable'))
    getStateMock.mockReturnValue({
      activeWorktreeId: 'worktree-1',
      closeSettingsPage,
      openBrowserProfileTabInActiveWorkspace
    })

    emitBrowserCookieImportToast(
      { ...summary, googleCookiesSkipped: true },
      'Imported 3 cookies.',
      'profile-1'
    )
    successToastMock.mock.calls[0][1].action.onClick()

    await vi.waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1))
    expect(closeSettingsPage).not.toHaveBeenCalled()
  })

  it('omits the sign-in action when no worktree can host the tab', () => {
    const openBrowserProfileTabInActiveWorkspace = vi.fn()
    getStateMock.mockReturnValue({
      activeWorktreeId: null,
      closeSettingsPage: vi.fn(),
      openBrowserProfileTabInActiveWorkspace
    })

    emitBrowserCookieImportToast(
      { ...summary, googleCookiesSkipped: true },
      'Imported 3 cookies.',
      'profile-1'
    )

    expect(successToastMock).toHaveBeenCalledTimes(1)
    expect(successToastMock.mock.calls[0][1].description).toBe(
      'Open a browser in Orca with this profile, then sign into Google.'
    )
    expect(successToastMock.mock.calls[0][1].action).toBeUndefined()
    expect(openBrowserProfileTabInActiveWorkspace).not.toHaveBeenCalled()
  })
})
