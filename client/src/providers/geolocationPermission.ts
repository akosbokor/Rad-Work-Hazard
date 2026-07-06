/**
 * Primes the OS geolocation permission prompt before the drive screen mounts.
 * The position itself is discarded — fixes enter the app only through a
 * PositionProvider. Resolves on grant, deny, or missing API alike so the
 * caller can always proceed (demo mode must work without GPS).
 */
export function requestGeolocationPermission(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => resolve(),
        () => resolve(),
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    } else {
      resolve();
    }
  });
}
