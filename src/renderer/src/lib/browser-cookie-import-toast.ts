import { toast } from 'sonner'
import type { BrowserCookieImportSummary } from '../../../shared/types'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

type CookieImportWarning = NonNullable<BrowserCookieImportSummary['warning']>

function formatCookieImportWarning(warning: CookieImportWarning): string {
  switch (warning.code) {
    case 'restart-fallback-unavailable':
      return warning.loadedCookies === 0
        ? translate(
            'auto.lib.browser.cookie.import.toast.restartFallbackUnavailableNone',
            'None of the {{value0}} cookies could be loaded, and the restart fallback was unavailable. The previous cookies for this profile were replaced. Try the import again.',
            { value0: warning.failedCookies }
          )
        : translate(
            'auto.lib.browser.cookie.import.toast.restartFallbackUnavailablePartial',
            'Imported {{value0}} of {{value1}} cookies. The rest could not be loaded, and the restart fallback was unavailable. Try the import again.',
            {
              value0: warning.loadedCookies,
              value1: warning.loadedCookies + warning.failedCookies
            }
          )
  }
}

const GOOGLE_SIGN_IN_URL = 'https://accounts.google.com/'

// Why: Google binds sessions server-side to the source browser, so imported Google cookies sign out within ~1h (STA-3811); a one-time direct sign-in is the only path that sticks.
function emitGoogleDirectSignInNotice(): void {
  toast.info(
    translate(
      'auto.lib.browser.cookie.import.toast.googleDirectSignIn',
      "Google can't stay signed in with imported cookies. Sign in once in a browser tab to keep your Google session."
    ),
    {
      duration: 12000,
      action: {
        label: translate(
          'auto.lib.browser.cookie.import.toast.googleDirectSignInAction',
          'Sign in to Google'
        ),
        onClick: () => {
          const store = useAppStore.getState()
          const worktreeId = store.activeWorktreeId
          if (!worktreeId) {
            return
          }
          // Why: the import surfaces include the Settings page, which would cover the new tab.
          store.closeSettingsPage()
          store.createBrowserTab(worktreeId, GOOGLE_SIGN_IN_URL, { activate: true })
        }
      }
    }
  )
}

// Why: a degraded import returns ok:true with a warning, so every call site must route it to a
// warning toast instead of reporting an unqualified success (#9355).
export function emitBrowserCookieImportToast(
  summary: BrowserCookieImportSummary,
  successMessage: string
): void {
  const warning = summary.warning
  if (warning) {
    toast.warning(formatCookieImportWarning(warning))
  } else {
    toast.success(successMessage)
  }
  if (summary.googleCookiesPresent) {
    emitGoogleDirectSignInNotice()
  }
}
