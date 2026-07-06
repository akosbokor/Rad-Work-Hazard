import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { t } from '../i18n';

/**
 * Small "scan to join on your phone" QR on the start screen. Encodes the URL
 * this page is already served from (`window.location.origin`) so a second
 * device on the same LAN / tunnel lands on the exact same app — nothing to
 * type, nothing to install. Rendered fully client-side (qrcode → data URL);
 * no network call, works offline.
 */
export function QrJoin() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    QRCode.toDataURL(origin, { width: 176, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err) => console.warn('[QrJoin] QR render failed:', err));
    return () => {
      cancelled = true;
    };
  }, [origin]);

  if (!dataUrl) return null;

  return (
    <div className="qr-join">
      <img className="qr-join-img" src={dataUrl} alt={t('start.qrCaption')} width={88} height={88} />
      <span className="qr-join-caption">{t('start.qrCaption')}</span>
    </div>
  );
}
