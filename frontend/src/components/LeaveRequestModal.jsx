import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import { LEAVE_TYPE_KEYS, labelFor } from '../utils/enumLabels';

const LEAVE_TYPE_OPTIONS = [
  { value: 'annual', key: 'leaveType.annual' },
  { value: 'sick', key: 'leaveType.sick' },
  { value: 'emergency', key: 'leaveType.emergency' },
  { value: 'unpaid', key: 'leaveType.unpaid' },
  { value: 'maternity', key: 'leaveType.maternity' },
  { value: 'bereavement', key: 'leaveType.bereavement' },
  { value: 'marriage', key: 'leaveType.marriage' },
];

// Leave dates arrive as plain calendar dates (YYYY-MM-DD). Building the value
// from the parts keeps the day intact, which slicing the ISO string would not.
function toDateInput(value) {
  if (!value) return '';
  const text = String(value).trim();
  const bare = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (bare) return bare[0];
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * One modal for both filing a leave request for an employee and editing an
 * existing request. In create mode the employee can be picked, which lets HR
 * and managers put somebody on leave when that employee cannot reach the
 * portal. In edit mode the employee is fixed and only the request details can
 * change.
 */
export default function LeaveRequestModal({ mode, request, onClose, onSaved }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isEdit = mode === 'edit';
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [document, setDocument] = useState(null);
  const [form, setForm] = useState({
    user_id: request?.user_id ? String(request.user_id) : '',
    leave_type: request?.leave_type || 'annual',
    start_date: toDateInput(request?.start_date),
    end_date: toDateInput(request?.end_date),
    reason: request?.reason || '',
    approve_now: false,
  });

  useEffect(() => {
    if (isEdit) return;
    api.get('/users')
      .then((res) => setEmployees(
        res.data.filter((u) => ['employee', 'manager'].includes(u.role) && u.id !== user?.id)
      ))
      .catch(() => setEmployees([]));
  }, [isEdit, user?.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (isEdit) {
        const payload = new FormData();
        payload.append('leave_type', form.leave_type);
        payload.append('start_date', form.start_date);
        payload.append('end_date', form.end_date);
        payload.append('reason', form.reason || '');
        if (document) payload.append('document', document);
        const res = await api.patch(`/leave/${request.id}`, payload);
        onSaved(res.data);
        return;
      }

      if (!form.user_id) {
        setError(t('leave.selectEmployeeRequired'));
        setSaving(false);
        return;
      }
      const payload = new FormData();
      payload.append('user_id', form.user_id);
      payload.append('leave_type', form.leave_type);
      payload.append('start_date', form.start_date);
      payload.append('end_date', form.end_date);
      payload.append('reason', form.reason || '');
      payload.append('approve_now', form.approve_now ? 'true' : 'false');
      if (document) payload.append('document', document);
      const res = await api.post('/leave', payload);
      onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.error || t('leave.saveFailed'));
      setSaving(false);
    }
  };

  const selectedEmployee = employees.find((e) => String(e.id) === form.user_id);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEdit ? t('leave.editRequest') : t('leave.addForEmployee')}</h3>
          <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="form-group">
              <label>{t('leave.employee')}</label>
              {isEdit ? (
                <input
                  value={`${request?.first_name || ''} ${request?.last_name || ''}`.trim() || t('leave.employee')}
                  readOnly
                  disabled
                />
              ) : (
                <select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} required>
                  <option value="">{t('leave.selectEmployee')}</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name} - {emp.position || emp.email}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="form-group">
              <label>{t('leave.leaveType')}</label>
              <select value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>
                {LEAVE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{labelFor(LEAVE_TYPE_KEYS, option.value, t)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('leave.startDate')}</label>
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>{t('leave.endDate')}</label>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
            </div>
          </div>

          <div className="form-group">
            <label>{t('leave.reason')}</label>
            <textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t('leave.optionalReason')} />
          </div>

          <div className="form-group">
            <label>{form.leave_type === 'sick' ? t('leave.sickDocument') : t('leave.document')}</label>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx"
              onChange={(e) => setDocument(e.target.files?.[0] || null)}
              required={form.leave_type === 'sick' && !isEdit}
            />
            {form.leave_type === 'sick' && <small className="form-hint">{t('leave.sickDocumentRequired')}</small>}
            {isEdit && request?.document_id && <small className="form-hint">{t('leave.documentAlreadyAttached')}</small>}
          </div>

          {!isEdit && (
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.approve_now}
                  onChange={(e) => setForm({ ...form, approve_now: e.target.checked })}
                />
                {t('leave.approveImmediately')}
              </label>
              <small className="form-hint">{t('leave.approveImmediatelyHint')}</small>
            </div>
          )}

          {selectedEmployee && (
            <small className="form-hint">
              {t('leave.employeeStatus')}: {selectedEmployee.status}
            </small>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : isEdit ? t('common.save') : t('leave.saveForEmployee')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
