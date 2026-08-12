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

type GoogleSignInToastOptions = {
  description: string
  duration: number
  action?: { label: string; onClick: () => void }
}

function signInTabUnavailableMessage(): string {
  return translate(
    'auto.lib.browser.cookie.import.toast.googleDirectSignInUnavailable',
    'Could not open the browser profile. Open it and sign in at accounts.google.com.'
  )
}

function googleSignInToastOptions(profileId: string): GoogleSignInToastOptions {
  const options: GoogleSignInToastOptions = {
    description: translate(
      'auto.lib.browser.cookie.import.toast.googleSkipped',
      "Google wasn't imported. Sign in directly to use Google in this profile."
    ),
    duration: GOOGLE_NOTICE_DURATION_MS
  }
  if (!useAppStore.getState().activeWorktreeId) {
    return {
      ...options,
      description: translate(
        'auto.lib.browser.cookie.import.toast.googleSkippedWithoutActiveWorktree',
        'Open a browser in Orca with this profile, then sign into Google.'
      )
    }
  }
  return {
    ...options,
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
  }
}

// Why: a degraded import returns ok:true with a warning, so every call site must route it to a
// warning toast instead of reporting an unqualified success (#9355).
export function emitBrowserCookieImportToast(
  summary: BrowserCookieImportSummary,
  successMessage: string,
  profileId: string
): void {
  const warning = summary.warning
  const googleOptions = summary.googleCookiesSkipped
    ? googleSignInToastOptions(profileId)
    : undefined
  if (warning) {
    const message = formatCookieImportWarning(warning)
    if (googleOptions) {
      toast.warning(message, googleOptions)
    } else {
      toast.warning(message)
    }
  } else {
    if (googleOptions) {
      toast.success(successMessage, googleOptions)
    } else {
      toast.success(successMessage)
    }
  }
}
