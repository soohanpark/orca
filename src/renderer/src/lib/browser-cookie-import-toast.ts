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
const GOOGLE_NOTICE_DURATION_MS = 12000

function signInTabUnavailableMessage(): string {
  return translate(
    'auto.lib.browser.cookie.import.toast.googleDirectSignInUnavailable',
    'Could not open a browser tab. Open one and sign in at accounts.google.com to keep your Google session.'
  )
}

// Why: Google binds sessions server-side to the source browser, so imported Google cookies sign out within ~1h (STA-3811); a one-time direct sign-in is the only path that sticks.
function emitGoogleDirectSignInNotice(profileId: string): void {
  const message = translate(
    'auto.lib.browser.cookie.import.toast.googleDirectSignIn',
    "Google can't stay signed in with imported cookies. Sign in once in a browser tab to keep your Google session."
  )

  // Why: the action needs an active worktree to host the tab; offering it without one is a button that silently does nothing.
  if (!useAppStore.getState().activeWorktreeId) {
    toast.info(message, { duration: GOOGLE_NOTICE_DURATION_MS })
    return
  }

  toast.info(message, {
    duration: GOOGLE_NOTICE_DURATION_MS,
    action: {
      label: translate(
        'auto.lib.browser.cookie.import.toast.googleDirectSignInAction',
        'Sign in to Google'
      ),
      onClick: () => {
        void useAppStore
          .getState()
          .openBrowserProfileTabInActiveWorkspace(GOOGLE_SIGN_IN_URL, profileId)
          .then((opened) => {
            if (!opened) {
              toast.error(signInTabUnavailableMessage())
              return
            }
            // Why: the import surfaces include the Settings page, which would cover the new tab.
            useAppStore.getState().closeSettingsPage()
          })
          .catch(() => {
            toast.error(signInTabUnavailableMessage())
          })
      }
    }
  })
}

// Why: a degraded import returns ok:true with a warning, so every call site must route it to a
// warning toast instead of reporting an unqualified success (#9355).
export function emitBrowserCookieImportToast(
  summary: BrowserCookieImportSummary,
  successMessage: string,
  profileId: string
): void {
  const warning = summary.warning
  if (warning) {
    toast.warning(formatCookieImportWarning(warning))
  } else {
    toast.success(successMessage)
  }
  if (summary.googleCookiesPresent) {
    emitGoogleDirectSignInNotice(profileId)
  }
}
