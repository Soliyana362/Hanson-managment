import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n';
import LanguageSwitcher from '../components/LanguageSwitcher';
import api from '../api/client';
import './Login.css';

export default function ForgotPassword() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const response = await api.post('/auth/forgot-password', { email });
      setMessage(response.data.message);
    } catch (err) {
      setError(err.response?.data?.error || t('forgotPassword.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/hanson-logo.png" alt="Hanson" className="login-logo" />
          <h1>{t('forgotPassword.title')}</h1>
          <p>{t('forgotPassword.headerSubtitle')}</p>
        </div>

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
          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? t('forgotPassword.sending') : t('forgotPassword.sendLink')}
          </button>
        </form>

        {message && <div className="success-msg">{message}</div>}
        {error && <div className="error-msg">{error}</div>}
        <Link className="back-link" to="/login">{t('forgotPassword.backToLogin')}</Link>

        <div className="login-language">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
