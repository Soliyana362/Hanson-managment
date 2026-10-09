import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import LanguageSwitcher from '../components/LanguageSwitcher';
import api from '../api/client';
import './Login.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailUnverified, setEmailUnverified] = useState(false);
  const [lockoutError, setLockoutError] = useState('');
  const [lockoutTimeLeft, setLockoutTimeLeft] = useState(0);
  const [lockoutTimerActive, setLockoutTimerActive] = useState(false);
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  useEffect(() => {
    if (!lockoutTimerActive) return undefined;
    const interval = setInterval(() => {
      setLockoutTimeLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutTimerActive]);

  useEffect(() => {
    if (!lockoutTimerActive || lockoutTimeLeft > 0) return;
    setLockoutTimerActive(false);
    setLockoutError('');
    setEmail('');
    setPassword('');
  }, [lockoutTimerActive, lockoutTimeLeft]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setEmailUnverified(false);
    setLockoutError('');
    setLoading(true);

    try {
      const user = await login(email, password);
      navigate(user.role === 'coo' ? '/coo' : '/dashboard');
    } catch (err) {
      if (err.response?.status === 429) {
        setLockoutError(err.response?.data?.error || t('login.tooManyAttempts'));
        setLockoutTimeLeft(300);
        setLockoutTimerActive(true);
      } else if (err.response?.status === 403 && err.response?.data?.emailVerified === false) {
        setError(err.response.data.error);
        setEmailUnverified(true);
      } else {
        setError(err.response?.data?.error || t('login.loginFailed'));
      }
    } finally {
      setLoading(false);
      setPassword('');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/hanson-logo.png" alt="Hanson" className="login-logo" />
          <h1>{t('common.appName')}</h1>
          <p>{t('common.tagline')}</p>
        </div>

        {lockoutError && <div className="error-msg">{lockoutError}</div>}
        {lockoutTimerActive && (
          <div className="timer-wrap">
            <span className="timer-text timer-expired">
              {t('login.lockout')}: {Math.floor(lockoutTimeLeft / 60)}:{String(lockoutTimeLeft % 60).padStart(2, '0')} {t('login.remaining')}
            </span>
          </div>
        )}
        {error && !lockoutTimerActive && <div className="error-msg">{error}</div>}
        {emailUnverified && !lockoutTimerActive && (
          <Link
            className="back-link"
            to={`/verify-email?email=${encodeURIComponent(email)}`}
          >
            {t('login.resendVerification')}
          </Link>
        )}

        {!lockoutTimerActive && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{t('login.email')}</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder={t('login.emailPlaceholder')}
                required
              />
            </div>
            <div className="form-group">
              <label>{t('login.password')}</label>
              <div className="password-input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder={t('login.passwordPlaceholder')}
                  required
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                >
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
              {loading ? t('login.signingIn') : t('login.signIn')}
            </button>
            <Link className="forgot-link" to="/forgot-password">{t('login.forgotPassword')}</Link>
          </form>
        )}

        <div className="login-language">
          <LanguageSwitcher />
        </div>

        <div className="legal-links" style={{ justifyContent: 'center', marginTop: '16px' }}>
          <Link to="/terms">{t('login.terms')}</Link>
          <Link to="/privacy">{t('login.privacy')}</Link>
        </div>
      </div>
    </div>
  );
}
