/**
 * Embed mode: the FleetmaxX mobile app opens the web's reports inside a
 * WebView (client, 2026-11-10: every web report in the app, kept in step with
 * the web without a new APK). The app draws its own header and tab bar, so
 * here the web's sidebar and top bar are hidden (index.css, html[data-embed]).
 *
 * Switched on by `?embed=1` on the first URL the app loads, then remembered
 * for the tab in sessionStorage, so in-app navigation keeps it.
 */

const KEY = 'ft-embed'

function detect() {
  try {
    if (new URLSearchParams(window.location.search).get('embed') === '1') sessionStorage.setItem(KEY, '1')
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const IS_EMBED = typeof window !== 'undefined' && detect()

if (IS_EMBED) document.documentElement.dataset.embed = '1'
