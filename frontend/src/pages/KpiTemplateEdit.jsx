import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { indicatorRatingScaleRules, templateName, templateRoleTitle } from '../utils/kpiContent';
import api from '../api/client';

function parseNumber(value) {
  if (value === '' || value === null || value === undefined) return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : '';
}

function blankRow() {
  return { key: `new-${Math.random().toString(36).slice(2)}`, id: null, name: '', definition: '', target: 100, weight: '', rating_criteria: '' };
}

function toRow(item) {
  return {
    key: `row-${item.id}`,
    id: item.id,
    name: item.name || '',
    definition: item.definition || '',
    rating_criteria: item.rating_criteria || '',
    target: Number(item.target || 0),
    weight: Number(item.weight || 0),
  };
}

// Screen for creating a KPI template and editing an existing one (title, definition,
// target, weight and rating criteria). Filling in a KPI entry never edits these.
export default function KpiTemplateEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const isNew = !id || id === 'new';

  const [template, setTemplate] = useState(null);
  const [details, setDetails] = useState({ name: '', department: '', role_title: '', description: '' });
  const [rows, setRows] = useState([blankRow()]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isNew) {
      setRows([blankRow()]);
      return;
    }
    api
      .get(`/kpi/templates/${id}`)
      .then(({ data }) => {
        setTemplate(data);
        setDetails({
          name: data.name || '',
          department: data.department || '',
          role_title: data.role_title || '',
          description: data.description || '',
        });
        setRows((data.items || []).map(toRow));
      })
      .catch((err) => setError(err.response?.data?.error || t('kpi.templateLoadFailed')))
      .finally(() => setLoading(false));
  }, [id, isNew, t]);

  const updateRow = (key, field, value) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
    setMessage('');
  };

  const addRow = () => setRows((prev) => [...prev, blankRow()]);

  const removeRow = (key) => setRows((prev) => (prev.length === 1 ? prev : prev.filter((row) => row.key !== key)));

  const weightTotal = rows.reduce((sum, row) => sum + Number(row.weight || 0), 0);
  const weightsValid = Math.abs(weightTotal - 100) < 0.001;
  const rowsValid =
    rows.length > 0 &&
    rows.every((row) => row.name.trim() && Number(row.target) >= 0 && Number(row.weight) >= 0);
  const detailsValid = !isNew || details.name.trim().length > 0;
  const canSave = detailsValid && rowsValid && weightsValid && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (isNew) {
        const res = await api.post('/kpi/templates', {
          name: details.name,
          department: details.department,
          role_title: details.role_title,
          description: details.description,
          items: rows.map((row) => ({
            name: row.name,
            definition: row.definition,
            target: row.target,
            weight: row.weight,
            rating_criteria: row.rating_criteria,
          })),
        });
        setMessage(t('kpi.templateCreated'));
        navigate(`/kpi/templates/${res.data.id}/edit`, { replace: true });
        return;
      }
      const res = await api.put(`/kpi/templates/${id}/items`, {
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          definition: row.definition,
          rating_criteria: row.rating_criteria,
          target: row.target,
          weight: row.weight,
        })),
      });
      setRows((res.data.items || []).map(toRow));
      setMessage(t('kpi.templateSaved'));
    } catch (err) {
      setError(err.response?.data?.error || t('kpi.templateSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page"><p>{t('common.loading')}</p></div>;

  return (
    <div className="page">
      <h1>{isNew ? t('kpi.newTemplate') : t('kpi.editKpi')}</h1>
      {!isNew && template && (
        <p>
          <strong>{templateName(template, t, language)}</strong>
          {template.role_title ? ` — ${templateRoleTitle(template, t, language) ?? template.role_title}` : ''}
        </p>
      )}
      <p style={{ color: '#6F8F73' }}>{t('kpi.editKpiHelp')}</p>

      {error && <div className="error-msg">{error}</div>}

      {isNew && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div className="form-group">
              <label>{t('kpi.templateName')}</label>
              <input
                value={details.name}
                onChange={(e) => setDetails({ ...details, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>{t('kpi.roleTitle')}</label>
              <input
                value={details.role_title}
                onChange={(e) => setDetails({ ...details, role_title: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>{t('common.department')}</label>
              <input
                value={details.department}
                onChange={(e) => setDetails({ ...details, department: e.target.value })}
              />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>{t('kpi.description')}</label>
            <input
              value={details.description}
              onChange={(e) => setDetails({ ...details, description: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('kpi.indicator')}</th>
                <th>{t('kpi.definition')}</th>
                <th>{t('kpi.target')}</th>
                <th>{t('kpi.weight')}</th>
                <th>{t('kpi.ratingCriteria')}</th>
                {isNew && <th style={{ width: '90px' }}>{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const legend = template
                  ? indicatorRatingScaleRules(template, { name: row.name }, t, 'rating')
                  : null;
                return (
                  <tr key={row.key}>
                    <td style={{ minWidth: '200px' }}>
                      <input
                        value={row.name}
                        onChange={(e) => updateRow(row.key, 'name', e.target.value)}
                        style={{ width: '100%', padding: '6px 8px' }}
                      />
                    </td>
                    <td style={{ minWidth: '280px' }}>
                      <textarea
                        rows={3}
                        value={row.definition}
                        onChange={(e) => updateRow(row.key, 'definition', e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', fontSize: '0.85rem' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={row.target}
                        onChange={(e) => updateRow(row.key, 'target', parseNumber(e.target.value))}
                        style={{ width: '100px', padding: '6px 8px' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={row.weight}
                        onChange={(e) => updateRow(row.key, 'weight', parseNumber(e.target.value))}
                        style={{ width: '80px', padding: '6px 8px' }}
                      />
                    </td>
                    <td style={{ minWidth: '260px' }}>
                      <textarea
                        rows={2}
                        value={row.rating_criteria}
                        onChange={(e) => updateRow(row.key, 'rating_criteria', e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', fontSize: '0.85rem' }}
                      />
                      {legend && (
                        <div style={{ fontSize: '0.75rem', color: '#6F8F73', marginTop: '4px' }}>
                          {t('kpi.builtInLegend')}: {legend.join(' | ')}
                        </div>
                      )}
                    </td>
                    {isNew && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => removeRow(row.key)}
                          disabled={rows.length === 1}
                        >
                          {t('kpi.removeKpi')}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F4F9F5', fontWeight: 700 }}>
                <td colSpan={3} style={{ textAlign: 'right' }}>{t('kpi.weightTotal')}</td>
                <td style={{ color: weightsValid ? undefined : '#C62828' }}>
                  <strong>{Number(weightTotal.toFixed(2))}</strong>
                </td>
                <td colSpan={isNew ? 2 : 1} />
              </tr>
            </tfoot>
          </table>
        </div>
        {!weightsValid && (
          <p style={{ color: '#C62828', marginTop: '8px' }}>{t('kpi.weightsMustTotal100')}</p>
        )}
        {isNew && (
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '12px' }} onClick={addRow}>
            {t('kpi.addKpi')}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!canSave}>
          {saving ? t('common.saving') : isNew ? t('kpi.createTemplate') : t('kpi.saveTemplate')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/kpi/templates')}>
          {t('common.cancel')}
        </button>
        {message && <span className="success-msg">{message}</span>}
      </div>
    </div>
  );
}