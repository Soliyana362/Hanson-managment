import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, locale, language, formatDate, formatCurrency } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [docsVersion, setDocsVersion] = useState(0);
  const isHr = ['hr', 'admin'].includes(user?.role);
  const canIssueCertificate = ['hr', 'admin', 'coo'].includes(user?.role);
  const canIssueWarning = ['hr', 'admin', 'coo'].includes(user?.role);
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
  const isSelf = Number(profile.id) === Number(user?.id);
  const canRemoveEmployee = user?.role === 'admin' && !isSelf && profile.role !== 'admin';
  const canChangeEmployeeStatus = !isSelf && (
    user?.role === 'admin'
      || (user?.role === 'hr' && ['employee', 'manager'].includes(profile.role))
  );
  const nextStatus = profile.status === 'inactive' ? 'active' : 'inactive';

  const removeEmployee = async () => {
    setRemoving(true);
    setRemoveError('');
    try {
      await api.delete(`/users/${profile.id}`);
      navigate('/employees', { replace: true });
    } catch (err) {
      setRemoveError(err.response?.data?.error || t('employees.removeEmployeeFailed'));
      setRemoving(false);
    }
  };

  const changeEmployeeStatus = async () => {
    setUpdatingStatus(true);
    setStatusError('');
    try {
      await api.put(`/users/${profile.id}`, { status: nextStatus });
      setShowStatusConfirm(false);
      await load();
    } catch (err) {
      setStatusError(err.response?.data?.error || t('employees.updateStatusFailed'));
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div className="page-header">
          <h1>{profile.first_name} {profile.last_name}</h1>
          <p>{t('employeeDetail.subtitle')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '12px' }}>
            {isHr && (
              <button className="btn btn-primary" onClick={() => setShowEdit(true)}>{t('employeeDetail.editEmployee')}</button>
            )}
            {canChangeEmployeeStatus && (
              <button
                className={`btn ${profile.status === 'inactive' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setStatusError(''); setShowStatusConfirm(true); }}
              >
                {profile.status === 'inactive' ? t('employees.reactivateEmployee') : t('employees.deactivateEmployee')}
              </button>
            )}
            {canRemoveEmployee && (
              <button className="btn btn-danger" onClick={() => { setRemoveError(''); setShowRemove(true); }}>
                {t('employees.removeEmployee')}
              </button>
            )}
            <Link to={user?.role === 'coo' ? '/coo' : '/employees'} className="btn btn-secondary btn-sm">{t('common.back')}</Link>
          </div>
        </div>
        <div
          onClick={photoUrl ? () => setShowPhoto(true) : undefined}
          role={photoUrl ? 'button' : undefined}
          tabIndex={photoUrl ? 0 : undefined}
          onKeyDown={photoUrl ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowPhoto(true); } } : undefined}
          aria-label={photoUrl ? t('employeeDetail.viewPhoto') : undefined}
          title={photoUrl ? t('employeeDetail.viewPhoto') : undefined}
          style={{
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
            cursor: photoUrl ? 'pointer' : 'default',
          }}
        >
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

      {showRemove && (
        <div className="modal-overlay" onClick={() => (removing ? null : setShowRemove(false))}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('employees.removeEmployee')}</h3>
            </div>
            <p style={{ margin: '0 0 12px' }}>
              {t('employees.removeEmployeeConfirm', { name: `${profile.first_name} ${profile.last_name}` })}
            </p>
            <p style={{ margin: '0 0 20px', color: 'var(--danger, #c62828)' }}>
              {t('employees.removeEmployeeWarning')}
            </p>
            {removeError && <p role="alert" style={{ color: 'var(--danger, #c62828)', margin: '0 0 16px' }}>{removeError}</p>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowRemove(false)} disabled={removing}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-danger" onClick={removeEmployee} disabled={removing}>
                {removing ? t('employees.removingEmployee') : t('common.yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showStatusConfirm && (
        <div className="modal-overlay" onClick={() => (updatingStatus ? null : setShowStatusConfirm(false))}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{nextStatus === 'inactive' ? t('employees.deactivateEmployee') : t('employees.reactivateEmployee')}</h3>
            </div>
            <p style={{ margin: '0 0 20px' }}>
              {nextStatus === 'inactive'
                ? t('employees.deactivateEmployeeConfirm', { name: `${profile.first_name} ${profile.last_name}` })
                : t('employees.reactivateEmployeeConfirm', { name: `${profile.first_name} ${profile.last_name}` })}
            </p>
            {statusError && <p role="alert" style={{ color: 'var(--danger, #c62828)', margin: '0 0 16px' }}>{statusError}</p>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowStatusConfirm(false)} disabled={updatingStatus}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={`btn ${nextStatus === 'inactive' ? 'btn-danger' : 'btn-primary'}`}
                onClick={changeEmployeeStatus}
                disabled={updatingStatus}
              >
                {updatingStatus
                  ? t('employees.updatingStatus')
                  : nextStatus === 'inactive' ? t('employees.deactivateEmployee') : t('employees.reactivateEmployee')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPhoto && photoUrl && (
        <div
          className="modal-overlay"
          style={{ background: 'rgba(0, 0, 0, 0.75)' }}
          onClick={() => setShowPhoto(false)}
        >
          <img
            src={photoUrl}
            alt={t('employeeDetail.profilePhotoAlt')}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              width: 'auto',
              height: 'auto',
              borderRadius: '8px',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
              objectFit: 'contain',
            }}
          />
          <button
            className="modal-close"
            onClick={() => setShowPhoto(false)}
            aria-label={t('common.close')}
            style={{ position: 'absolute', top: 20, right: 20, color: '#fff' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
