import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import api from '../api/client';
import EmployeeStatusChart from '../components/EmployeeStatusChart';
import PerformanceChart from '../components/PerformanceChart';
import EmployeeFiles from '../components/EmployeeFiles';

export default function Dashboard() {
  const { user } = useAuth();
  const { t, formatNumber } = useLanguage();
  const [data, setData] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [attachFiles, setAttachFiles] = useState([]);
  const attachInputRef = useRef(null);
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '',
    role: 'employee', department_id: '', department_other: '', position: '', hire_date: '', phone: '',
    gender: '', age: '',
    tin_number: '', pension_number: '', emergency_contact: '', bank_account: '',
    gross_salary: '', transport_allowance: '',
    education: '', education_other: '',
  });

  // `value` is what gets persisted to the database, so it stays English.
  const EDUCATION_OPTIONS = [
    { value: 'High School', label: 'education.highSchool' },
    { value: 'Diploma', label: 'education.diploma' },
    { value: 'Certificate', label: 'education.certificate' },
    { value: "Bachelor's Degree", label: 'education.bachelors' },
    { value: "Master's Degree", label: 'education.masters' },
    { value: 'PhD', label: 'education.phd' },
    { value: 'Other', label: 'common.other' },
  ];
  const GENDER_OPTIONS = [
    { value: 'female', label: 'employees.female' },
    { value: 'male', label: 'employees.male' },
  ];

  useEffect(() => {
    const load = () => api.get('/dashboard').then((res) => setData(res.data)).catch(console.error);
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const isManager = ['hr', 'admin', 'manager'].includes(user?.role);
  const isHr = ['hr', 'admin'].includes(user?.role);

  const openAdd = () => {
    setFormError('');
    setFormSuccess('');
    setAttachFiles([]);
    api.get('/users/departments').then((res) => setDepartments(res.data)).catch(console.error);
    setShowAdd(true);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    try {
      const { education, education_other, department_id, department_other, ...rest } = form;
      let deptId = department_id;
      if (department_id === 'other') {
        if (!department_other.trim()) {
          setFormError(t('employees.typeDepartmentName'));
          return;
        }
        const dep = await api.post('/users/departments', { name: department_other });
        deptId = dep.data.id;
      }
      const payload = { ...rest, department_id: deptId || null, education: education === 'Other' ? education_other : education };
      const created = await api.post('/users', payload);
      if (attachFiles.length > 0) {
        for (const file of attachFiles) {
          const fd = new FormData();
          fd.append('document', file);
          fd.append('userId', created.data.id);
          await api.post('/uploads/document', fd);
        }
      }
      setFormSuccess(
        created.data.emailSent === false
          ? t('employees.addedEmailFailed')
          : t('employees.addedEmailSent')
      );
      setAttachFiles([]);
      setForm({
        first_name: '', last_name: '', email: '',
        role: 'employee', department_id: '', department_other: '', position: '', hire_date: '', phone: '',
        gender: '', age: '',
        tin_number: '', pension_number: '', emergency_contact: '', bank_account: '',
        gross_salary: '', transport_allowance: '',
        education: '', education_other: '',
      });
      api.get('/dashboard').then((res) => setData(res.data)).catch(console.error);
    } catch (err) {
      setFormError(err.response?.data?.error || t('employees.addFailed'));
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{t('dashboard.welcomeName', { name: user?.first_name })}</h1>
          {user?.role === 'hr' ? (
            <p>{t('dashboard.hrOverviewToday')}</p>
          ) : (
            <p>{t('dashboard.departmentOverviewFor', { department: data?.profile?.department_name || user?.department_name || t('dashboard.your') })}</p>
          )}
        </div>
        {isHr && (
          <button className="btn btn-primary" onClick={openAdd}>+ {t('employees.addEmployee')}</button>
        )}
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">{t('dashboard.employmentStatus')}</div>
          <div className="value" style={{ fontSize: '1.25rem' }}>
            <span className={`badge badge-${data?.profile?.status || 'active'}`}>
              {t(`employmentStatus.${data?.profile?.status || 'active'}`)}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="label">{t('dashboard.annualLeaveBalance')}</div>
          <div className="value">{data?.profile?.annual_leave_balance ?? '—'} {t('common.days')}</div>
        </div>
        {isManager && (
          <div className="stat-card">
            <div className="label">{t('dashboard.pendingLeaveReviews')}</div>
            <div className="value">{data?.pendingReviews ?? 0}</div>
          </div>
        )}
        {data?.team && (
          <>
            <div className="stat-card">
              <div className="label">{t('dashboard.totalEmployees')}</div>
              <div className="value">{data.team.total_employees}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('dashboard.currentlyOnLeave')}</div>
              <div className="value">{data.team.on_leave}</div>
            </div>
          </>
        )}
      </div>

      <section style={{ marginBottom: '24px' }}>
        <EmployeeFiles userId={user.id} hidePhoto />
      </section>

      {data?.kpiHistory && data.kpiHistory.length > 0 ? (
        <div className="grid-split">
          <div className="card">
            <h3 style={{ marginBottom: '12px', color: '#2E7D32' }}>{t('dashboard.myPerformance')}</h3>
            <PerformanceChart history={data.kpiHistory} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="card">
              <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('dashboard.yourLeaveSummary')}</h3>
              <p><strong>{t('dashboard.pending')}:</strong> {formatNumber(data?.leave?.pending ?? 0)} {t('dashboard.requests')}</p>
              <p><strong>{t('dashboard.approved')}:</strong> {formatNumber(data?.leave?.approved ?? 0)} {t('dashboard.requests')}</p>
              <p style={{ marginTop: '12px', color: '#6F8F73', fontSize: '0.875rem' }}>
                {t('common.department')}: {data?.profile?.department_name || user?.department_name || '—'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '28px' }}>
          <div className="card">
            <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('dashboard.yourLeaveSummary')}</h3>
            <p><strong>{t('dashboard.pending')}:</strong> {formatNumber(data?.leave?.pending ?? 0)} {t('dashboard.requests')}</p>
            <p><strong>{t('dashboard.approved')}:</strong> {formatNumber(data?.leave?.approved ?? 0)} {t('dashboard.requests')}</p>
            <p style={{ marginTop: '12px', color: '#6F8F73', fontSize: '0.875rem' }}>
              {t('common.department')}: {data?.profile?.department_name || user?.department_name || '—'}
            </p>
          </div>
        </div>
      )}

      {data?.team && (
        <div style={{ marginBottom: '28px' }}>
          <EmployeeStatusChart team={data.team} />
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('employees.addEmployee')}</h3>
              <button className="modal-close" onClick={() => setShowAdd(false)} aria-label={t('common.close')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {formError && <div className="error-msg">{formError}</div>}
            {formSuccess && <div className="success-msg">{formSuccess}</div>}

            <form onSubmit={handleAdd}>
              <div className="grid-2">
                <div className="form-group">
                  <label>{t('employees.firstName')}</label>
                  <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>{t('employees.lastName')}</label>
                  <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>{t('common.email')}</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>{t('common.role')}</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    <option value="employee">{t('roles.employee')}</option>
                    <option value="manager">{t('roles.manager')}</option>
                    <option value="hr">{t('roles.hr')}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>{t('common.department')}</label>
                  <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                    <option value="">—</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                    <option value="other">{t('common.other')}</option>
                  </select>
                </div>
                {form.department_id === 'other' && (
                  <div className="form-group">
                    <label>{t('employees.departmentOther')}</label>
                    <input value={form.department_other} onChange={(e) => setForm({ ...form, department_other: e.target.value })} placeholder={t('employees.typeDepartmentName')} required />
                  </div>
                )}
                <div className="form-group">
                  <label>{t('common.position')}</label>
                  <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('employees.hireDate')}</label>
                  <input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('common.phone')}</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('employees.gender')}</label>
                  <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                    <option value=""></option>
                    {GENDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>{t('employees.age')}</label>
                  <input type="number" min="0" max="130" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('employees.tinNumber')}</label>
                  <input value={form.tin_number} onChange={(e) => setForm({ ...form, tin_number: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('employees.pensionNumber')}</label>
                  <input value={form.pension_number} onChange={(e) => setForm({ ...form, pension_number: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('employees.emergencyContact')}</label>
                  <input value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('employees.bankAccount')}</label>
                  <input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('employees.grossSalary')}</label>
                  <input type="number" step="0.01" value={form.gross_salary} onChange={(e) => setForm({ ...form, gross_salary: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('employees.transportAllowance')}</label>
                  <input type="number" step="0.01" value={form.transport_allowance} onChange={(e) => setForm({ ...form, transport_allowance: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('employees.education')}</label>
                  <select value={form.education} onChange={(e) => setForm({ ...form, education: e.target.value })}>
                    <option value="">—</option>
                    {EDUCATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
                    ))}
                  </select>
                </div>
                {form.education === 'Other' && (
                  <div className="form-group">
                    <label>{t('employees.educationOther')}</label>
                    <input value={form.education_other} onChange={(e) => setForm({ ...form, education_other: e.target.value })} placeholder={t('employees.typeEducation')} required />
                  </div>
                )}
              </div>
              <div style={{ marginBottom: '12px' }}>
                <input
                  ref={attachInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    setAttachFiles([...attachFiles, ...Array.from(e.target.files || [])]);
                    e.target.value = '';
                  }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => attachInputRef.current?.click()}>
                  {t('employees.attachFile')}
                </button>
                {attachFiles.length > 0 && (
                  <span style={{ marginLeft: '10px', fontSize: '0.8rem', color: '#6F8F73' }}>
                    {t('employees.filesAttached', { count: attachFiles.length })}
                  </span>
                )}
                {attachFiles.length > 0 && (
                  <ul style={{ margin: '10px 0 0', paddingLeft: '20px' }}>
                    {attachFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} style={{ fontSize: '0.85rem', marginBottom: '4px' }}>
                        {f.name}{' '}
                        <button
                          type="button"
                          onClick={() => setAttachFiles(attachFiles.filter((_, idx) => idx !== i))}
                          style={{ border: 'none', background: 'none', color: '#E53935', cursor: 'pointer', fontSize: '0.85rem' }}
                        >
                          {t('common.remove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button type="submit" className="btn btn-primary">{t('employees.addEmployee')}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
