/**
 * Thin wrapper around the Web Notifications API. Everything is feature-checked
 * and try/catch-guarded so it silently no-ops where unsupported (e.g. iOS
 * Safari, headless) and only ever fires where the user granted permission.
 * Works on Android Chrome / desktop.
 */

/** Ask for notification permission (once). Call inside a user gesture. */
export function requestNotificationPermission(): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    /* no-op — notifications are a nice-to-have */
  }
}

/** Show a system notification if (and only if) permission was granted. */
export function showNotification(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    new Notification(title, { body });
  } catch {
    /* no-op */
  }
}
