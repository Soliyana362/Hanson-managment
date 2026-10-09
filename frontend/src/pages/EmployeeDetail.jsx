import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import {
  EDUCATION_KEYS,
  EMPLOYMENT_STATUS_KEYS,
  GENDER_KEYS,
  KPI_STATUS_KEYS,
  LEAVE_STATUS_KEYS,
  LEAVE_TYPE_KEYS,
  ROLE_KEYS,
  labelFor,
} from '../utils/enumLabels';
import EmployeeFiles from '../components/EmployeeFiles';
import EmployeeLetters from '../components/EmployeeLetters';
import EditEmployeeModal from '../components/EditEmployeeModal';
import { displayPeriodLabel } from '../utils/periodLabel';
import { templateName } from '../utils/kpiContent';

export default function EmployeeDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, locale, language, formatDate, formatCurrency } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [docsVersion, setDocsVersion] = useState(0);
  const isHr = ['hr', 'admin'].includes(user?.role);
  const canIssueCertificate = ['hr', 'admin', 'coo'].includes(user?.role);
  const canIssueWarning = ['hr', 'admin'].includes(user?.role);
  const keepRawPeriodLabel = user?.role === 'manager';

  const load = () => api.get(`/users/${id}/status`).then((res) => setData(res.data)).catch(console.error).finally(() => setLoading(false));

  useEffect(() => {
    const urls = [];
    load();

    api.get(`/uploads?userId=${id}`)
      .then((res) => {
        const photo = res.data.find((d) => d.category === 'profile_photo');
        if (!photo) return;
        api.get(`/uploads/file/${photo.id}`, { responseType: 'blob' })
          .then((fr) => {
            const url = URL.createObjectURL(fr.data);
            urls.push(url);
            setPhotoUrl(url);
          });
      });

    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [id]);

  if (loading) return <p>{t('common.loading')}</p>;
  if (!data) return <p>{t('employeeDetail.loadFailed')}</p>;

  const { profile, recentLeave, recentKpis } = data;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div className="page-header">
          <h1>{profile.first_name} {profile.last_name}</h1>
          <p>{t('employeeDetail.subtitle')}</p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            {isHr && (
              <button className="btn btn-primary" onClick={() => setShowEdit(true)}>{t('employeeDetail.editEmployee')}</button>
            )}
            <Link to={user?.role === 'coo' ? '/coo' : '/employees'} className="btn btn-secondary btn-sm">{t('common.back')}</Link>
          </div>
        </div>
        <div style={{
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: '#ECEFF1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: '3px solid #4CAF50',
          flexShrink: 0,
        }}>
          {photoUrl ? (
            <img src={photoUrl} alt={t('employeeDetail.profilePhotoAlt')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ color: '#9DBB9E', fontSize: '2rem', fontWeight: 600 }}>
              {profile.first_name?.[0]}{profile.last_name?.[0]}
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '20px', color: '#2E7D32' }}>{t('employeeDetail.profile')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div><strong>{t('common.name')}</strong><br />{profile.first_name} {profile.last_name}</div>
          <div><strong>{t('common.email')}</strong><br />{profile.email}</div>
          <div><strong>{t('common.role')}</strong><br />{labelFor(ROLE_KEYS, profile.role, t)}</div>
          <div><strong>{t('common.position')}</strong><br />{profile.position || '—'}</div>
          <div><strong>{t('common.department')}</strong><br />{profile.department_name || '—'}</div>
          <div><strong>{t('common.status')}</strong><br />
            <span className={`badge badge-${profile.status}`}>{labelFor(EMPLOYMENT_STATUS_KEYS, profile.status, t)}</span>
          </div>
          <div><strong>{t('common.manager')}</strong><br />
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

      <EmployeeLetters
        userId={profile.id}
        employeeName={`${profile.first_name} ${profile.last_name}`}
        canIssueCertificate={canIssueCertificate}
        canIssueWarning={canIssueWarning}
        onIssued={() => setDocsVersion((value) => value + 1)}
      />

      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '12px', color: '#2E7D32' }}>{t('employeeDetail.documents')}</h3>
        <EmployeeFiles key={docsVersion} userId={profile.id} readonly={!isHr} hidePhoto />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('employeeDetail.leaveBalances')}</h3>
          <p><strong>{t('leaveType.annual')}:</strong> {t('employeeDetail.daysRemaining', { count: profile.annual_leave_balance })}</p>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('employeeDetail.recentLeaveRequests')}</h3>
          {recentLeave.length === 0 ? (
            <p className="empty-state">{t('employeeDetail.noLeaveRequests')}</p>
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
        <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('employeeDetail.recentKpiReviews')}</h3>
        {recentKpis.length === 0 ? (
          <p className="empty-state">{t('employeeDetail.noKpiReviews')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('kpi.template')}</th>
                  <th>{t('kpi.period')}</th>
                  <th>{t('kpi.score')}</th>
                  <th>{t('kpi.rating')}</th>
                  <th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {recentKpis.map((k) => (
                  <tr key={k.id}>
                    <td>{templateName(k, t, language)}</td>
                    <td>{displayPeriodLabel(k.period_label, keepRawPeriodLabel, { locale, t })}</td>
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

      {showEdit && (
        <EditEmployeeModal
          profile={profile}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}
    </div>
  );
}
