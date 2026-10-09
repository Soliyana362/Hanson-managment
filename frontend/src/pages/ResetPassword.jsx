import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n';
import LanguageSwitcher from '../components/LanguageSwitcher';
import api from '../api/client';
import './Login.css';

export default function ResetPassword() {
  const { t } = useLanguage();
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (password.length < 12) {
      setError(t('resetPassword.tooShort'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('resetPassword.mismatch'));
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/reset-password', { token, newPassword: password });
      setMessage(response.data.message);
      setPassword('');
      setConfirmPassword('');
      setToken('');
      window.history.replaceState({}, document.title, '/reset-password');
    } catch (err) {
      setError(err.response?.data?.error || t('resetPassword.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/hanson-logo.png" alt="Hanson" className="login-logo" />
          <h1>{t('resetPassword.chooseNewPassword')}</h1>
          <p>{t('resetPassword.headerSubtitle')}</p>
        </div>

        {!token ? (
          <div className="error-msg">{t('resetPassword.missingLink')}</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{t('resetPassword.newPassword')}</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </div>
            <div className="form-group">
              <label>{t('profile.confirmNewPassword')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
              {loading ? t('resetPassword.resetting') : t('resetPassword.reset')}
            </button>
          </form>
        )}

        {message && <div className="success-msg">{message}</div>}
        {error && <div className="error-msg">{error}</div>}
        <Link className="forgot-link" to="/forgot-password">{t('resetPassword.requestNewLink')}</Link>
        <Link className="back-link" to="/login">{t('forgotPassword.backToLogin')}</Link>

        <div className="login-language">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
