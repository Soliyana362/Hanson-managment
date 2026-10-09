import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import { LEAVE_STATUS_KEYS, LEAVE_TYPE_KEYS, labelFor } from '../utils/enumLabels';
import api from '../api/client';

const LEAVE_TYPE_OPTIONS = [
  { value: 'annual', key: 'leaveType.annual' },
  { value: 'sick', key: 'leaveType.sick' },
  { value: 'emergency', key: 'leaveType.emergency' },
  { value: 'unpaid', key: 'leaveType.unpaid' },
  { value: 'other', key: 'leaveType.other' },
];

export default function LeaveRequests() {
  const { t } = useLanguage();
  const [requests, setRequests] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ leave_type: 'annual', start_date: '', end_date: '', reason: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = () => api.get('/leave').then((res) => setRequests(res.data)).catch(console.error);
  useEffect(() => { load(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api.post('/leave', form);
      setSuccess(t('leave.submitted'));
      setShowForm(false);
      setForm({ leave_type: 'annual', start_date: '', end_date: '', reason: '' });
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
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr><td colSpan={7} className="empty-state">{t('leave.noRequests')}</td></tr>
              ) : requests.map((r) => (
                <tr key={r.id}>
                  <td>{labelFor(LEAVE_TYPE_KEYS, r.leave_type, t)}</td>
                  <td>{new Date(r.start_date).toLocaleDateString()}</td>
                  <td>{new Date(r.end_date).toLocaleDateString()}</td>
                  <td>{r.days_requested}</td>
                  <td>{r.reason || '—'}</td>
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
