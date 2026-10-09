import { useEffect, useState } from 'react';
import api from '../api/client';
import { useLanguage } from '../i18n';
import {
  EDUCATION_KEYS,
  EMPLOYMENT_STATUS_KEYS,
  GENDER_KEYS,
  ROLE_KEYS,
  labelFor,
} from '../utils/enumLabels';

// Submitted values stay in English so the database enum values never change.
const EDUCATION_OPTIONS = ['High School', 'Diploma', 'Certificate', "Bachelor's Degree", "Master's Degree", 'PhD', 'Other'];
const GENDER_OPTIONS = ['female', 'male', 'other', 'prefer_not_to_say'];
const ROLE_OPTIONS = ['employee', 'manager', 'hr', 'admin', 'coo'];
const STATUS_OPTIONS = ['active', 'on_leave', 'inactive'];

function CustomSelect({ value, label, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const list = open ? (
    <div className="custom-select__list">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          className={`custom-select__option${opt.value === value ? ' custom-select__option--active' : ''}`}
          onClick={() => { onChange(opt.value); setOpen(false); }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  ) : null;
  return (
    <div className="custom-select">
      <button type="button" className="custom-select__trigger" onClick={() => setOpen(!open)}>
        <span>{label || placeholder || '—'}</span>
        <span className={`custom-select__arrow${open ? ' custom-select__arrow--up' : ''}`}>▾</span>
      </button>
      {list}
    </div>
  );
}

export default function EditEmployeeModal({ profile, onClose, onSaved }) {
  const { t } = useLanguage();
  const [departments, setDepartments] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: profile.first_name || '',
    last_name: profile.last_name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    gender: profile.gender || '',
    age: profile.age ?? '',
    role: profile.role || 'employee',
    position: profile.position || '',
    department_id: profile.department_id != null ? String(profile.department_id) : '',
    department_other: '',
    status: profile.status || 'active',
    hire_date: profile.hire_date?.slice(0, 10) || '',
    tin_number: profile.tin_number || '',
    pension_number: profile.pension_number || '',
    emergency_contact: profile.emergency_contact || '',
    bank_account: profile.bank_account || '',
    gross_salary: profile.gross_salary ?? '',
    transport_allowance: profile.transport_allowance ?? '',
    education: profile.education || '',
    education_other: '',
  });

  useEffect(() => {
    api.get('/users/departments').then((res) => setDepartments(res.data)).catch(() => {});
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      let deptId = form.department_id;
      if (form.department_id === 'other') {
        if (!form.department_other.trim()) {
          setError(t('employees.typeDepartmentName'));
          setSaving(false);
          return;
        }
        const dep = await api.post('/users/departments', { name: form.department_other });
        deptId = dep.data.id;
      }
      const payload = { ...form, department_id: deptId || null, education: form.education === 'Other' ? form.education_other : form.education };
      const res = await api.put(`/users/${profile.id}`, payload);
      onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.error || t('employees.editFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('employeeDetail.editEmployee')}</h3>
          <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSave}>
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
              <label>{t('employees.phone')}</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('employees.gender')}</label>
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">{t('common.notSet')}</option>
                {GENDER_OPTIONS.map((v) => <option key={v} value={v}>{labelFor(GENDER_KEYS, v, t)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('employees.age')}</label>
              <input type="number" min="0" max="130" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('employees.role')}</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{labelFor(ROLE_KEYS, r, t)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('employees.position')}</label>
              <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('employees.department')}</label>
              <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                <option value="">{t('common.notSet')}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
                <option value="other">{t('employees.other')}</option>
              </select>
            </div>
            {form.department_id === 'other' && (
              <div className="form-group">
                <label>{t('employees.departmentOther')}</label>
                <input value={form.department_other} onChange={(e) => setForm({ ...form, department_other: e.target.value })} placeholder={t('employees.typeDepartmentName')} required />
              </div>
            )}
            <div className="form-group">
              <label>{t('employees.status')}</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{labelFor(EMPLOYMENT_STATUS_KEYS, s, t)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('employees.hireDate')}</label>
              <input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
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
              <CustomSelect
                value={form.education}
                label={form.education ? labelFor(EDUCATION_KEYS, form.education, t) : ''}
                onChange={(v) => setForm({ ...form, education: v })}
                options={EDUCATION_OPTIONS.map((v) => ({ value: v, label: labelFor(EDUCATION_KEYS, v, t) }))}
                placeholder={t('employees.selectEducation')}
              />
            </div>
            {form.education === 'Other' && (
              <div className="form-group">
                <label>{t('employees.educationOther')}</label>
                <input value={form.education_other} onChange={(e) => setForm({ ...form, education_other: e.target.value })} placeholder={t('employees.typeEducation')} required />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
