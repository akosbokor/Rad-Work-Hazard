import { useEffect } from 'react';
import { useAppStore } from '../store';
import { chime, vibrate } from '../audio';
import { showNotification } from '../notify';
import { t } from '../i18n';

/**
 * Dismissible, severity-coloured banner near the top of the drive screen that
 * surfaces admin→driver broadcasts (store.adminMessage). On arrival it fires
 * the existing chime + vibration and a system notification; it auto-dismisses
 * after 20 s. The dismiss control is a ≥48px touch target.
 */

const AUTO_DISMISS_MS = 20_000;
const VIBRATION_PATTERN = [300, 100, 300];

export function AdminMessageToast() {
  const adminMessage = useAppStore((s) => s.adminMessage);
  const dismiss = useAppStore((s) => s.dismissAdminMessage);

  // Fire on every new message (each SSE event yields a fresh object ref).
  useEffect(() => {
    if (!adminMessage) return;
    chime();
    vibrate(VIBRATION_PATTERN);
    showNotification('M1 Figyelő', adminMessage.text);
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [adminMessage, dismiss]);

  if (!adminMessage) return null;

  return (
    <div className={`admin-toast sev-${adminMessage.severity}`} role="alert">
      <span className="admin-toast-text">{adminMessage.text}</span>
      <button
        type="button"
        className="admin-toast-dismiss"
        onClick={dismiss}
        aria-label={t('toast.dismiss')}
      >
        ×
      </button>
    </div>
  );
}
