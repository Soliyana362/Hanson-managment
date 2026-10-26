import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import { LEAVE_STATUS_KEYS, LEAVE_TYPE_KEYS, labelFor } from '../utils/enumLabels';
import api from '../api/client';

const LEAVE_TYPE_OPTIONS = [
  { value: 'annual', key: 'leaveType.annual' },
  { value: 'sick', key: 'leaveType.sick' },
  { value: 'unpaid', key: 'leaveType.unpaid' },
  { value: 'maternity', key: 'leaveType.maternity' },
  { value: 'bereavement', key: 'leaveType.bereavement' },
  { value: 'marriage', key: 'leaveType.marriage' },
];

const EMPTY_FORM = { leave_type: 'annual', start_date: '', end_date: '', reason: '' };

export default function LeaveRequests() {
  const { t, formatDate } = useLanguage();
  const [requests, setRequests] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [document, setDocument] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = () => api.get('/leave').then((res) => setRequests(res.data)).catch(console.error);
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setDocument(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (form.leave_type === 'sick' && !document) {
      setError(t('leave.sickDocumentRequired'));
      return;
    }
    try {
      const payload = new FormData();
      payload.append('leave_type', form.leave_type);
      payload.append('start_date', form.start_date);
      payload.append('end_date', form.end_date);
      payload.append('reason', form.reason || '');
      if (document) payload.append('document', document);
      await api.post('/leave', payload);
      setSuccess(t('leave.submitted'));
      setShowForm(false);
      resetForm();
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('leave.submitFailed'));
    }
  };

  const handleCancel = async (id) => {
    try {
      await api.patch(`/leave/${id}/cancel`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('leave.cancelFailed'));
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{t('leave.title')}</h1>
          <p>{t('leave.subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? t('common.cancel') : `+ ${t('leave.newRequest')}`}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {success && <div className="success-msg">{success}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('leave.newRequest')}</h3>
          <form onSubmit={handleSubmit}>
            <div className="grid-2">
              <div className="form-group">
                <label>{t('leave.leaveType')}</label>
                <select value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>
                  {LEAVE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{t(option.key)}</option>
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
                required={form.leave_type === 'sick'}
              />
              {form.leave_type === 'sick' && <small className="form-hint">{t('leave.sickDocumentRequired')}</small>}
            </div>
            <button type="submit" className="btn btn-primary">{t('leave.submit')}</button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('common.type')}</th>
                <th>{t('leave.start')}</th>
                <th>{t('leave.end')}</th>
                <th>{t('leave.days')}</th>
                <th>{t('leave.reason')}</th>
                <th>{t('leave.document')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr><td colSpan={8} className="empty-state">{t('leave.noRequests')}</td></tr>
              ) : requests.map((r) => (
                <tr key={r.id}>
                  <td>{labelFor(LEAVE_TYPE_KEYS, r.leave_type, t)}</td>
                  <td>{formatDate(r.start_date)}</td>
                  <td>{formatDate(r.end_date)}</td>
                  <td>{r.days_requested}</td>
                  <td>{r.reason || '—'}</td>
                  <td>
                    {r.document_id ? (
                      <a href={`/api/leave/${r.id}/document`} target="_blank" rel="noreferrer">{t('leave.viewDocument')}</a>
                    ) : '—'}
                  </td>
                  <td><span className={`badge badge-${r.status}`}>{labelFor(LEAVE_STATUS_KEYS, r.status, t)}</span></td>
                  <td>
                    {r.status === 'pending' && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleCancel(r.id)}>{t('leave.cancelRequest')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
