import { useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';

const today = () => new Date().toISOString().slice(0, 10);

export default function EmployeeLetters({ userId, employeeName, canIssueCertificate, canIssueWarning, onIssued }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const issuerKey = user?.role === 'coo' ? 'roles.coo' : 'roles.hr';
  const [mode, setMode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [certificate, setCertificate] = useState({
    achievement: '',
    details: '',
    issued_date: today(),
  });
  const [warning, setWarning] = useState({
    subject: '',
    incident_date: today(),
    details: '',
    required_action: '',
  });

  const resetMessages = () => {
    setError('');
    setSuccess('');
  };

  const submitCertificate = async (e) => {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      await api.post(`/letters/${userId}/certificate`, certificate);
      setSuccess(t('letters.certificateSent'));
      setCertificate({ achievement: '', details: '', issued_date: today() });
      setMode('');
      onIssued?.();
    } catch (err) {
      setError(err.response?.data?.error || t('letters.certificateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const submitWarning = async (e) => {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      await api.post(`/letters/${userId}/warning`, warning);
      setSuccess(t('letters.warningSent'));
      setWarning({ subject: '', incident_date: today(), details: '', required_action: '' });
      setMode('');
      onIssued?.();
    } catch (err) {
      setError(err.response?.data?.error || t('letters.warningFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!canIssueCertificate && !canIssueWarning) return null;

  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ color: '#2E7D32' }}>{t('letters.heading', { issuer: t(issuerKey) })}</h3>
          <p style={{ color: '#6F8F73', marginTop: '4px' }}>{t('letters.subtitle', { name: employeeName })}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {canIssueCertificate && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { resetMessages(); setMode('certificate'); }}>
              {t('letters.sendCertificate')}
            </button>
          )}
          {canIssueWarning && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { resetMessages(); setMode('warning'); }}>
              {t('letters.warningLetter')}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {success && <div className="success-msg">{success}</div>}

      {mode === 'certificate' && (
        <form onSubmit={submitCertificate}>
          <div className="form-group">
            <label>{t('letters.achievement')}</label>
            <input
              value={certificate.achievement}
              onChange={(e) => setCertificate({ ...certificate, achievement: e.target.value })}
              placeholder={t('letters.achievementPlaceholder')}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('letters.issueDate')}</label>
            <input
              type="date"
              value={certificate.issued_date}
              onChange={(e) => setCertificate({ ...certificate, issued_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>{t('letters.details')}</label>
            <textarea
              rows="4"
              value={certificate.details}
              onChange={(e) => setCertificate({ ...certificate, details: e.target.value })}
              placeholder={t('letters.detailsPlaceholder')}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? t('common.sending') : t('letters.sendCertificate')}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setMode('')}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {mode === 'warning' && (
        <form onSubmit={submitWarning}>
          <div className="form-group">
            <label>{t('letters.subject')}</label>
            <input
              value={warning.subject}
              onChange={(e) => setWarning({ ...warning, subject: e.target.value })}
              placeholder={t('letters.subjectPlaceholder')}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('letters.incidentDate')}</label>
            <input
              type="date"
              value={warning.incident_date}
              onChange={(e) => setWarning({ ...warning, incident_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>{t('letters.details')}</label>
            <textarea
              rows="4"
              value={warning.details}
              onChange={(e) => setWarning({ ...warning, details: e.target.value })}
              placeholder={t('letters.warningDetailsPlaceholder')}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('letters.requiredAction')}</label>
            <textarea
              rows="3"
              value={warning.required_action}
              onChange={(e) => setWarning({ ...warning, required_action: e.target.value })}
              placeholder={t('letters.requiredActionPlaceholder')}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? t('common.sending') : t('letters.sendWarning')}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setMode('')}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
