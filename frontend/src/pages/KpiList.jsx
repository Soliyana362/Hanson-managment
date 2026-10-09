import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import { KPI_STATUS_KEYS, labelFor } from '../utils/enumLabels';
import { templateName } from '../utils/kpiContent';
import api from '../api/client';
import { displayPeriodLabel } from '../utils/periodLabel';

export default function KpiList() {
  const { user } = useAuth();
  const { t, locale, language } = useLanguage();
  const [submissions, setSubmissions] = useState([]);
  const [departmentAchievements, setDepartmentAchievements] = useState([]);
  const isManager = ['hr', 'admin', 'manager', 'coo'].includes(user?.role);
  const canFill = ['admin', 'manager'].includes(user?.role);
  const canApprove = ['hr', 'admin'].includes(user?.role);
  const canViewDepartmentAchievements = ['hr', 'admin', 'coo'].includes(user?.role);
  const keepRawPeriodLabel = user?.role === 'manager';

  const load = () => api.get('/kpi/submissions').then((res) => setSubmissions(res.data)).catch(console.error);
  const loadDepartmentAchievements = () => {
    if (!canViewDepartmentAchievements) return;
    api.get('/kpi/department-achievements')
      .then((res) => setDepartmentAchievements(res.data))
      .catch(console.error);
  };

  useEffect(() => {
    load();
    loadDepartmentAchievements();
  }, [canViewDepartmentAchievements]);

  const handleReview = async (id, status) => {
    try {
      await api.patch(`/kpi/submissions/${id}/review`, { status });
      load();
      loadDepartmentAchievements();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{t('kpi.title')}</h1>
          <p>{t('kpi.listSubtitle')}</p>
        </div>
        {canFill && (
          <Link to="/kpi/new" className="btn btn-primary">+ {t('kpi.newEntry')}</Link>
        )}
      </div>

      {canViewDepartmentAchievements && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('kpi.departmentPercentile')}</h3>
          {departmentAchievements.length === 0 ? (
            <p className="empty-state">{t('kpi.noDepartmentAchievements')}</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              {departmentAchievements.map((dept) => {
                const value = dept.achievement_pct == null ? 0 : Number(dept.achievement_pct);
                const width = `${Math.min(100, Math.max(0, value))}%`;
                return (
                  <div key={dept.department_name} style={{ border: '1px solid #DCEADA', borderRadius: '8px', padding: '16px', background: '#FFFFFF' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                      <strong style={{ color: '#1B5E20' }}>{dept.department_name}</strong>
                      <span style={{ color: '#2E7D32', fontWeight: 700 }}>
                        {dept.achievement_pct == null ? '-' : `${Number(value.toFixed(1))}%`}
                      </span>
                    </div>
                    <div style={{ height: '8px', background: '#EAF3EC', borderRadius: '999px', overflow: 'hidden', marginBottom: '8px' }}>
                      <div style={{ width, height: '100%', minWidth: dept.achievement_pct == null ? 0 : '4px', background: '#4CAF50', borderRadius: '999px' }} />
                    </div>
                    <span style={{ color: '#6F8F73', fontSize: '0.85rem' }}>
                      {t('kpi.entryCount', dept.submission_count)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {isManager && <th>{t('kpi.employee')}</th>}
                <th>{t('kpi.template')}</th>
                <th>{t('kpi.periodLabel')}</th>
                <th>{t('kpi.totalScore')}</th>
                <th>{t('kpi.overallRating')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {submissions.length === 0 ? (
                <tr><td colSpan={isManager ? 7 : 6} className="empty-state">{t('kpi.noSubmissions')}</td></tr>
              ) : submissions.map((s) => (
                <tr key={s.id}>
                  {isManager && <td>{s.employee_first_name} {s.employee_last_name}</td>}
                  <td>{templateName(s, t, language)}</td>
                  <td>{displayPeriodLabel(s.period_label, keepRawPeriodLabel, { locale, t })}</td>
                  <td>{s.total_weighted_score != null ? Number(Number(s.total_weighted_score).toFixed(2)) : '—'}</td>
                  <td>{s.overall_rating ? `${s.overall_rating}/5` : '—'}</td>
                  <td><span className={`badge badge-${s.status}`}>{labelFor(KPI_STATUS_KEYS, s.status, t)}</span></td>
                  {isManager ? (
                    <td style={{ display: 'flex', gap: '8px' }}>
                      {canFill ? (
                        <Link to={`/kpi/${s.id}`} className="btn btn-secondary btn-sm">{t('common.edit')}</Link>
                      ) : (
                        <Link to={`/kpi/${s.id}`} className="btn btn-secondary btn-sm">{t('common.view')}</Link>
                      )}
                      {canApprove && ['submitted', 'reviewed'].includes(s.status) && (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => handleReview(s.id, 'approved')}>{t('kpi.approve')}</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleReview(s.id, 'rejected')}>{t('kpi.decline')}</button>
                        </>
                      )}
                    </td>
                  ) : (
                    <td>
                      <Link to={`/kpi/${s.id}`} className="btn btn-secondary btn-sm">{t('common.view')}</Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
