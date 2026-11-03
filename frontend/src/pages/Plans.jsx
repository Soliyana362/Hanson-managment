import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n';
import api from '../api/client';
import './Reports.css';

const CURRENT_YEAR = new Date().getFullYear();

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Plans() {
  const { t, locale } = useLanguage();
  const fileInput = useRef(null);
  const [plans, setPlans] = useState([]);
  const [title, setTitle] = useState('');
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  const loadPlans = useCallback(async () => {
    setLoadError('');
    try {
      const response = await api.get('/plans');
      setPlans(response.data);
    } catch (err) {
      setLoadError(err.response?.data?.error || t('plans.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const handleUpload = async (event) => {
    event.preventDefault();
    setUploadError('');
    setUploadSuccess('');
    if (!file) {
      setUploadError(t('plans.chooseFile'));
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('year', year);
    formData.append('plan', file);

    setUploading(true);
    try {
      await api.post('/plans', formData);
      setTitle('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setUploadSuccess(t('plans.uploadSuccess'));
      await loadPlans();
    } catch (err) {
      setUploadError(err.response?.data?.error || t('plans.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const downloadPlan = async (plan) => {
    try {
      const response = await api.get(`/plans/${plan.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = plan.original_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setLoadError(err.response?.data?.error || t('plans.downloadFailed'));
    }
  };

  const uploadedDate = (value) => {
    const date = new Date(String(value || '').replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  };

  return (
    <div className="reports-page">
      <div className="page-header">
        <div>
          <h1>{t('plans.title')}</h1>
          <p>{t('plans.subtitle')}</p>
        </div>
        <Link to="/coo" className="btn btn-secondary">{t('coo.title')}</Link>
      </div>

      <section className="card report-upload-card">
        <div className="report-section-heading">
          <h2>{t('plans.addTitle')}</h2>
        </div>
        <form onSubmit={handleUpload}>
          <div className="report-form-grid">
            <div className="form-group">
              <label htmlFor="plan-title">{t('plans.name')}</label>
              <input id="plan-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
            </div>
            <div className="form-group">
              <label htmlFor="plan-year">{t('plans.year')}</label>
              <input
                id="plan-year"
                type="number"
                min="1900"
                max="2100"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                required
              />
            </div>
            <div className="form-group report-file-field">
              <label htmlFor="plan-file">{t('plans.file')}</label>
              <input
                ref={fileInput}
                id="plan-file"
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                required
              />
            </div>
          </div>
          <p className="report-upload-hint">{t('plans.accepted')}</p>
          {uploadError && <p className="error-msg" role="alert">{uploadError}</p>}
          {uploadSuccess && <p className="success-msg" role="status">{uploadSuccess}</p>}
          <button className="btn btn-primary" type="submit" disabled={uploading}>
            {uploading ? t('plans.uploading') : t('plans.addPlan')}
          </button>
        </form>
      </section>

      <section className="card report-list-card">
        <div className="report-list-heading">
          <h2>{t('plans.listTitle')}</h2>
        </div>
        {loadError && <p className="error-msg" role="alert">{loadError}</p>}
        {loading ? (
          <p className="report-empty-state">{t('common.loading')}</p>
        ) : plans.length === 0 ? (
          <p className="report-empty-state">{t('plans.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>{t('plans.name')}</th>
                  <th>{t('plans.year')}</th>
                  <th>{t('plans.file')}</th>
                  <th>{t('reports.uploaded')}</th>
                  <th aria-label={t('reports.download')} />
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td>{plan.title}</td>
                    <td>{plan.plan_year}</td>
                    <td className="report-filename">
                      <span>{plan.original_name}</span>
                      <small>{formatSize(plan.size_bytes)}</small>
                    </td>
                    <td>{uploadedDate(plan.created_at)}</td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadPlan(plan)}>
                        {t('reports.download')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
