import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import { KPI_STATUS_KEYS, labelFor } from '../utils/enumLabels';
import { KPI_RATING_CRITERIA_EN, indicatorDefinition, indicatorName, indicatorRatingScaleRules, ratingCriteria, templateName, templateRoleTitle } from '../utils/kpiContent';
import api from '../api/client';
import { displayPeriodLabel } from '../utils/periodLabel';
import KpiTranslationEditor from '../components/KpiTranslationEditor';

function calcScore(pct) {
  if (pct >= 100) return 5;
  if (pct >= 96) return 4;
  if (pct >= 90) return 3;
  if (pct >= 84) return 2;
  if (pct >= 79) return 1;
  return 0;
}

// Mirrors ratingFromTotalScore() on the server so a single indicator's rating
// uses the same 1-5 scale as the overall rating.
function calcRating(score) {
  if (score >= 4.5) return 5;
  if (score >= 3.5) return 4;
  if (score >= 2.5) return 3;
  if (score >= 1.5) return 2;
  return 1;
}

export default function KpiForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, locale, language } = useLanguage();
  const isEdit = Boolean(id);
  const canEdit = ['admin', 'manager'].includes(user?.role);
  const canApprove = ['hr', 'admin'].includes(user?.role);
  const canTranslate = ['hr', 'admin'].includes(user?.role);
  const canEditWeights = ['hr', 'admin', 'manager'].includes(user?.role);
  const keepRawPeriodLabel = user?.role === 'manager';

  const [templates, setTemplates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    template_id: '', employee_id: '', period_label: '',
    period_start: '2026-01-01', period_end: '2026-06-01', notes: '',
  });
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isEdit) return;
    Promise.all([
      api.get('/kpi/templates'),
      api.get('/users'),
    ]).then(([tRes, eRes]) => {
      setTemplates(tRes.data);
      setEmployees(eRes.data.filter((e) => e.role === 'employee'));
    }).catch(console.error);
  }, [isEdit]);

  useEffect(() => {
    if (isEdit) {
      api.get(`/kpi/submissions/${id}`).then((res) => {
        const s = res.data;
        setSubmission(s);
        setStatus(s.status);
        setForm({
          template_id: s.template_id,
          employee_id: s.employee_id,
          period_label: s.period_label,
          period_start: s.period_start?.slice(0, 10) || '',
          period_end: s.period_end?.slice(0, 10) || '',
          notes: s.notes || '',
        });
        setItems(s.items.map((i) => ({
          id: i.id,
          template_item_id: i.template_item_id,
          name: i.name,
          definition: i.definition,
          target: Number(i.target),
          weight: Number(i.weight),
          achievement: Number(i.achievement || 0),
          rating_criteria: i.rating_criteria,
          comments: i.comments || '',
        })));
      }).catch(console.error);
    }
  }, [id, isEdit]);

  const loadTemplateItems = async (templateId) => {
    const res = await api.get(`/kpi/templates/${templateId}`);
    setItems(res.data.items.map((i) => ({
      template_item_id: i.id,
      name: i.name,
      definition: i.definition,
      target: Number(i.target),
      weight: Number(i.weight),
      achievement: 0,
      rating_criteria: i.rating_criteria,
      comments: '',
    })));
  };

  const selectedTemplate = templates.find((t) => String(t.id) === String(form.template_id)) || null;

  const handleTemplateChange = (templateId) => {
    setForm({ ...form, template_id: templateId });
    if (templateId) loadTemplateItems(templateId);
    else setItems([]);
  };

  const updateItem = (index, field, value) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const totalScore = items.reduce((sum, item) => {
    const pct = item.target > 0 ? (item.achievement / item.target) * 100 : 0;
    const score = calcScore(pct);
    return sum + (score * item.weight) / 100;
  }, 0);

  // Indicator weights are raw shares of 100, not percentages: they are meant to
  // add up to 100 across the whole template.
  const weightTotal = items.reduce((sum, item) => sum + Number(item.weight || 0), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    setError('');
    setLoading(true);
    try {
      const payload = {
        ...form,
        template_id: Number(form.template_id),
        employee_id: Number(form.employee_id),
        items: items.map((i) => ({
          id: i.id,
          template_item_id: i.template_item_id,
          achievement: Number(i.achievement),
          target: i.target,
          weight: i.weight,
          comments: i.comments,
        })),
        status: 'submitted',
      };

      if (isEdit) {
        await api.put(`/kpi/submissions/${id}`, payload);
      } else {
        await api.post('/kpi/submissions', payload);
      }
      navigate('/kpi');
    } catch (err) {
      setError(err.response?.data?.error || t('kpi.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (reviewStatus) => {
    try {
      await api.patch(`/kpi/submissions/${id}/review`, { status: reviewStatus });
      navigate('/kpi');
    } catch (err) {
      setError(err.response?.data?.error || t('kpi.reviewFailed'));
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>{isEdit ? t('kpi.entry') : t('kpi.newEntry')}</h1>
        <p>{t('kpi.formIntro')}</p>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {isEdit && submission && !canEdit && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('kpi.reportSummary')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
            <div><strong>{t('kpi.employee')}</strong><br />{submission.employee_first_name} {submission.employee_last_name}{submission.employee_position ? ` — ${submission.employee_position}` : ''}</div>
            <div><strong>{t('kpi.template')}</strong><br />{templateName(submission, t, language)}</div>
            <div><strong>{t('kpi.periodLabel')}</strong><br />{displayPeriodLabel(submission.period_label, keepRawPeriodLabel, { locale, t })}</div>
            <div><strong>{t('common.status')}</strong><br /><span className={`badge badge-${submission.status}`}>{labelFor(KPI_STATUS_KEYS, submission.status, t)}</span></div>
            <div><strong>{t('kpi.reviewer')}</strong><br />{submission.reviewer_first_name ? `${submission.reviewer_first_name} ${submission.reviewer_last_name}` : '—'}</div>
            <div><strong>{t('kpi.overallRating')}</strong><br />{submission.overall_rating ? `${submission.overall_rating}/5` : '—'}</div>
          </div>
        </div>
      )}

      {canEditWeights && !isEdit && selectedTemplate && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', fontSize: '0.9rem', color: '#6F8F73' }}>
            <span>
              {t('kpi.selectedTemplate')}: <strong>{templateName(selectedTemplate, t, language)}</strong>
              {selectedTemplate.role_title
                ? ` (${templateRoleTitle(selectedTemplate, t, language) ?? selectedTemplate.role_title})`
                : ''}{' '}
              — {items.length} {t('kpi.indicators')} {t('kpi.readyToReview')}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/kpi/templates/${selectedTemplate.id}/edit`)}
            >
              {t('kpi.editKpi')}
            </button>
          </div>

          {canTranslate && (
            <KpiTranslationEditor
              template={selectedTemplate}
              onSaved={(updated) => {
                const { items: _ignored, ...templateRow } = updated;
                setTemplates((prev) => prev.map((tpl) => (tpl.id === updated.id ? { ...tpl, ...templateRow } : tpl)));
              }}
            />
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('kpi.evaluationDetails')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {!isEdit && (
              <>
                <div className="form-group">
                  <label>{t('kpi.template')}</label>
                  <select value={form.template_id} onChange={(e) => handleTemplateChange(e.target.value)} required>
                    <option value="">{t('kpi.selectTemplate')}</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {templateName(tpl, t, language)}
                        {tpl.role_title ? ` (${templateRoleTitle(tpl, t, language) ?? tpl.role_title})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>{t('kpi.employee')}</label>
                  <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} required>
                    <option value="">{t('kpi.selectEmployee')}</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.first_name} {e.last_name} — {e.position}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {isEdit && (
              <div className="form-group">
                <label>{t('kpi.periodLabel')}</label>
                <input value={form.period_label} onChange={(e) => setForm({ ...form, period_label: e.target.value })} readOnly={!canEdit} />
              </div>
            )}
            <div className="form-group">
              <label>{t('kpi.periodStart')}</label>
              <input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} readOnly={!canEdit} />
            </div>
            <div className="form-group">
              <label>{t('kpi.periodEnd')}</label>
              <input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} readOnly={!canEdit} />
            </div>
          </div>

          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              background: '#F4F9F5',
              borderRadius: '8px',
              fontSize: '0.85rem',
              color: '#6F8F73',
              whiteSpace: 'pre-line',
            }}
          >
            <strong>{t('kpi.ratings')}</strong>
            {'\n'}
            {ratingCriteria(items[0]?.rating_criteria || KPI_RATING_CRITERIA_EN, t)}
          </div>
        </div>

        {items.length > 0 && (
          <div className="card" style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ color: '#2E7D32' }}>{t('kpi.kpiIndicators')}</h3>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#2E7D32' }}>
                {t('kpi.totalScore')}: {Number(totalScore.toFixed(2))}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('kpi.indicator')}</th>
                    <th>{t('kpi.definition')}</th>
                    <th>{t('kpi.target')}</th>
                    <th>{t('kpi.achievement')}</th>
                    <th>{t('kpi.weight')}</th>
                    <th>{t('kpi.scoreAgainstAchievement')}</th>
                    <th>{t('kpi.totalScoreWithWeightage')}</th>
                    <th>{t('kpi.rating')}</th>
                    <th>{t('kpi.comments')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
const pct = item.target > 0 ? (item.achievement / item.target) * 100 : 0;
                    const score = calcScore(pct);
                    const weighted = (score * item.weight) / 100;
                    const defRules = selectedTemplate
                      ? indicatorRatingScaleRules(selectedTemplate, item, t, 'definition')
                      : null;
                    const ratingRules = selectedTemplate
                      ? indicatorRatingScaleRules(selectedTemplate, item, t, 'rating')
                      : null;
                    return (
                      <tr key={item.template_item_id || idx}>
                          <td style={{ minWidth: '180px', fontWeight: 600 }}>
                            {indicatorName(selectedTemplate, item, t, language)}
                          </td>
                          <td style={{ fontSize: '0.85rem', color: '#6F8F73', maxWidth: defRules ? '340px' : '250px' }}>
                            {defRules
                              ? defRules.map((rule) => <div key={rule}>{rule}</div>)
                              : indicatorDefinition(selectedTemplate, item, t, language) || item.definition}
                          </td>
                          <td>{Number(item.target) || 0}</td>
                        <td>
                          {canEdit ? (
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              value={item.achievement}
                              onChange={(e) => updateItem(idx, 'achievement', e.target.value)}
                              style={{ width: '80px', padding: '6px 8px' }}
                            />
                          ) : (
                            <span>{item.achievement}%</span>
                          )}
                        </td>
                        <td>{item.weight}</td>
                        <td>
                          <strong>{score}/5</strong>
                        </td>
                        <td><strong>{Number(weighted.toFixed(2))}</strong></td>
                        <td style={{ minWidth: '240px' }}>
                          {ratingRules ? (
                            <div style={{ fontSize: '0.8rem', color: '#6F8F73' }}>
                              {ratingRules.map((rule) => (
                                <div key={rule}>{rule}</div>
                              ))}
                            </div>
                          ) : (
                            <strong>{calcRating(score)}/5</strong>
                          )}
                        </td>
                        <td style={{ minWidth: '120px' }}>
                          {canEdit ? (
                            <input
                              value={item.comments}
                              onChange={(e) => updateItem(idx, 'comments', e.target.value)}
                              placeholder={t('kpi.notesPlaceholder')}
                              style={{ width: '120px', padding: '6px 8px' }}
                            />
                          ) : (
                            <span style={{ fontSize: '0.85rem', color: '#6F8F73' }}>{item.comments || '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#F4F9F5', fontWeight: 700 }}>
                    <td colSpan={4} style={{ textAlign: 'right' }}>{t('kpi.totalScore')}</td>
                    <td>
                      <strong>{Number(weightTotal.toFixed(2))}</strong>
                    </td>
                    <td />
                    <td><strong>{Number(totalScore.toFixed(2))}</strong></td>
                    <td><strong>{calcRating(totalScore)}/5</strong></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {canEdit && (
          <div className="form-group">
            <label>{t('common.notes')}</label>
            <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        )}
        {!canEdit && form.notes && (
          <div className="card" style={{ marginBottom: '24px' }}>
            <h3 style={{ marginBottom: '8px', color: '#2E7D32' }}>{t('common.notes')}</h3>
            <p style={{ color: '#6F8F73' }}>{form.notes}</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          {canEdit && (
            <button type="submit" className="btn btn-primary" disabled={loading || items.length === 0}>
              {loading ? t('kpi.saving') : t('kpi.saveEntry')}
            </button>
          )}
          {isEdit && canApprove && ['submitted', 'reviewed'].includes(status) && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => handleReview('approved')}>{t('kpi.approveKpi')}</button>
              <button type="button" className="btn btn-danger" onClick={() => handleReview('rejected')}>{t('kpi.declineKpi')}</button>
            </>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/kpi')}>{t('common.cancel')}</button>
        </div>
      </form>
    </div>
  );
}
