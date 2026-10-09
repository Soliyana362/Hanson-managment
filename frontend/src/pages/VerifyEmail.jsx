import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../i18n';
import LanguageSwitcher from '../components/LanguageSwitcher';
import api from '../api/client';
import './Login.css';

export default function VerifyEmail() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || params.get('token') || '');
  const [email, setEmail] = useState(params.get('email') || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const handleVerify = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const response = await api.post('/auth/verify-email', { token });
      setMessage(response.data.message);
      setToken('');
      window.history.replaceState({}, document.title, '/verify-email');
    } catch (err) {
      setError(err.response?.data?.error || t('verifyEmail.verifyFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setResending(true);

    try {
      const response = await api.post('/auth/resend-verification', { email });
      setMessage(response.data.message);
    } catch (err) {
      setError(err.response?.data?.error || t('verifyEmail.resendFailed'));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/hanson-logo.png" alt="Hanson" className="login-logo" />
          <h1>{t('verifyEmail.title')}</h1>
          <p>{t('verifyEmail.subtitle')}</p>
        </div>

        {token ? (
          <form onSubmit={handleVerify}>
            <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
              {loading ? t('verifyEmail.verifying') : t('verifyEmail.verifyNow')}
            </button>
          </form>
        ) : (
          <div className="error-msg">{t('verifyEmail.missingLink')}</div>
        )}

        {message && <div className="success-msg">{message}</div>}
        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleResend}>
          <div className="form-group">
            <label>{t('verifyEmail.accountEmail')}</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder={t('login.emailPlaceholder')}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary login-btn" disabled={resending}>
            {resending ? t('verifyEmail.sending') : t('verifyEmail.resend')}
          </button>
        </form>

        <Link className="back-link" to="/login">{t('forgotPassword.backToLogin')}</Link>

        <div className="login-language">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
