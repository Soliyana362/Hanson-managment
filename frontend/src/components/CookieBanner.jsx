import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n';

const STORAGE_KEY = 'glorious.cookieConsent';

export default function CookieBanner() {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(() => {
    try {
      return !localStorage.getItem(STORAGE_KEY);
    } catch {
      return true;
    }
  });

  if (!visible) return null;

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'accepted');
    } catch {
      // Best-effort: the banner simply reappears next visit if storage is unavailable.
    }
    setVisible(false);
  };

  return (
    <div className="cookie-banner" role="region" aria-label={t('cookieBanner.ariaLabel')}>
      <p className="cookie-banner-text">
        {t('cookieBanner.message')}{' '}
        <Link to="/privacy">{t('cookieBanner.privacyLink')}</Link>
      </p>
      <button type="button" className="btn btn-primary btn-sm" onClick={accept}>
        {t('cookieBanner.accept')}
      </button>
    </div>
  );
}
