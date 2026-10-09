import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import { EDUCATION_KEYS, EMPLOYMENT_STATUS_KEYS, GENDER_KEYS, KPI_STATUS_KEYS, LEAVE_STATUS_KEYS, LEAVE_TYPE_KEYS, labelFor } from '../utils/enumLabels';
import { templateName } from '../utils/kpiContent';
import api from '../api/client';
import EmployeeFiles from '../components/EmployeeFiles';
import { displayPeriodLabel } from '../utils/periodLabel';

export default function MyStatus() {
  const { user } = useAuth();
  const { t, locale, language, formatDate, formatCurrency } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/users/${user.id}/status`)
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user.id]);

  if (loading) return <p>{t('common.loading')}</p>;
  if (!data) return <p>{t('myStatus.loadFailed')}</p>;

  const { profile, recentLeave, recentKpis } = data;

  return (
    <div>
      <div className="page-header">
        <h1>{t('myStatus.title')}</h1>
        <p>{t('myStatus.subtitle')}</p>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '20px', color: '#2E7D32' }}>{t('myStatus.profile')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div><strong>{t('common.name')}</strong><br />{profile.first_name} {profile.last_name}</div>
          <div><strong>{t('common.email')}</strong><br />{profile.email}</div>
          <div><strong>{t('common.position')}</strong><br />{profile.position || '—'}</div>
          <div><strong>{t('common.department')}</strong><br />{profile.department_name || '—'}</div>
          <div><strong>{t('common.status')}</strong><br />
            <span className={`badge badge-${profile.status}`}>{labelFor(EMPLOYMENT_STATUS_KEYS, profile.status, t)}</span>
          </div>
          <div><strong>{t('myStatus.manager')}</strong><br />
            {profile.manager_first_name ? `${profile.manager_first_name} ${profile.manager_last_name}` : '—'}
          </div>
          <div><strong>{t('employees.hireDate')}</strong><br />{formatDate(profile.hire_date)}</div>
          <div><strong>{t('common.phone')}</strong><br />{profile.phone || '—'}</div>
          <div><strong>{t('employees.gender')}</strong><br />{labelFor(GENDER_KEYS, profile.gender, t)}</div>
          <div><strong>{t('employees.age')}</strong><br />{profile.age ?? '—'}</div>
          <div><strong>{t('employees.tinNumber')}</strong><br />{profile.tin_number || '—'}</div>
          <div><strong>{t('employees.pensionNumber')}</strong><br />{profile.pension_number || '—'}</div>
          <div><strong>{t('employees.emergencyContact')}</strong><br />{profile.emergency_contact || '—'}</div>
          <div><strong>{t('employees.bankAccount')}</strong><br />{profile.bank_account || '—'}</div>
          <div><strong>{t('employees.grossSalary')}</strong><br />{formatCurrency(profile.gross_salary)}</div>
          <div><strong>{t('employees.transportAllowance')}</strong><br />{formatCurrency(profile.transport_allowance)}</div>
          <div><strong>{t('employees.education')}</strong><br />{labelFor(EDUCATION_KEYS, profile.education, t)}</div>
        </div>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '12px', color: '#2E7D32' }}>{t('myStatus.myDocuments')}</h3>
        <EmployeeFiles userId={profile.id} hidePhoto />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('myStatus.leaveBalances')}</h3>
          <p><strong>{t('leaveType.annual')}:</strong> {profile.annual_leave_balance} {t('myStatus.daysRemaining')}</p>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('myStatus.recentLeaveRequests')}</h3>
          {recentLeave.length === 0 ? (
            <p className="empty-state">{t('myStatus.noLeaveRequests')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t('common.type')}</th><th>{t('myStatus.dates')}</th><th>{t('common.status')}</th></tr>
                </thead>
                <tbody>
                  {recentLeave.map((l) => (
                    <tr key={l.id}>
                      <td>{labelFor(LEAVE_TYPE_KEYS, l.leave_type, t)}</td>
                      <td>{formatDate(l.start_date)} – {formatDate(l.end_date)}</td>
                      <td><span className={`badge badge-${l.status}`}>{labelFor(LEAVE_STATUS_KEYS, l.status, t)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: '24px' }}>
        <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('myStatus.recentKpiReviews')}</h3>
        {recentKpis.length === 0 ? (
          <p className="empty-state">{t('myStatus.noKpiReviews')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t('kpi.template')}</th><th>{t('kpi.periodLabel')}</th><th>{t('kpi.score')}</th><th>{t('kpi.overallRating')}</th><th>{t('common.status')}</th></tr>
              </thead>
              <tbody>
                {recentKpis.map((k) => (
                  <tr key={k.id}>
                    <td>{templateName(k, t, language)}</td>
                    <td>{displayPeriodLabel(k.period_label, false, { locale, t })}</td>
                    <td>{k.total_weighted_score != null ? Number(Number(k.total_weighted_score).toFixed(2)) : '—'}</td>
                    <td>{k.overall_rating ?? '—'}/5</td>
                    <td><span className={`badge badge-${k.status}`}>{labelFor(KPI_STATUS_KEYS, k.status, t)}</span></td>
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
