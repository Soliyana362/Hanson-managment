import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import { templateName, templateRoleTitle } from '../utils/kpiContent';
import api from '../api/client';

// Lists the KPI templates and links to the editor. Templates are no longer created
// from a spreadsheet; they are maintained here.
export default function KpiTemplates() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const canDelete = ['hr', 'admin', 'manager'].includes(user?.role);

  const load = () => {
    setLoading(true);
    api
      .get('/kpi/templates')
      .then(({ data }) => setTemplates(data))
      .catch((err) => setError(err.response?.data?.error || t('kpi.templatesLoadFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDelete = async (template) => {
    const label = templateName(template, t, language);
    if (!window.confirm(t('kpi.deleteTemplateConfirm', { name: label }))) return;
    setDeletingId(template.id);
    setError('');
    try {
      await api.delete(`/kpi/templates/${template.id}`);
      setTemplates((prev) => prev.filter((row) => row.id !== template.id));
    } catch (err) {
      setError(err.response?.data?.error || t('kpi.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="page">
      <h1>{t('kpi.templatesTitle')}</h1>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <p style={{ margin: 0 }}>{t('kpi.templatesSubtitle')}</p>
        <Link to="/kpi/templates/new" className="btn btn-primary">
          {t('kpi.newTemplate')}
        </Link>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="card">
        {loading ? (
          <p style={{ color: '#6F8F73' }}>{t('common.loading')}</p>
        ) : templates.length === 0 ? (
          <p style={{ color: '#6F8F73' }}>{t('kpi.noTemplates')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('kpi.template')}</th>
                  <th>{t('kpi.role')}</th>
                  <th>{t('common.department')}</th>
                  <th style={{ textAlign: 'right' }}>{t('kpi.indicators')}</th>
                  <th style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td style={{ fontWeight: 600 }}>{templateName(template, t, language)}</td>
                    <td>{templateRoleTitle(template, t, language) ?? template.role_title ?? '—'}</td>
                    <td>{template.department ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {template.indicator_count ?? template.item_count ?? '—'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Link to={`/kpi/templates/${template.id}/edit`} className="btn btn-primary btn-sm">
                        {t('kpi.editKpi')}
                      </Link>{' '}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => navigate('/kpi/new')}
                      >
                        {t('kpi.useTemplate')}
                      </button>{' '}
                      {canDelete && (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(template)}
                          disabled={deletingId === template.id}
                        >
                          {deletingId === template.id ? t('kpi.deleting') : t('kpi.deleteTemplate')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}