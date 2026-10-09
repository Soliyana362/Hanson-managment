import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import { LEAVE_TYPE_KEYS, labelFor } from '../utils/enumLabels';
import api from '../api/client';

export default function LeaveReview() {
  const { t } = useLanguage();
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');

  const load = () => api.get('/leave').then((res) => setRequests(res.data.filter((r) => r.status === 'pending'))).catch(console.error);
  useEffect(() => { load(); }, []);

  const handleReview = async (id, status) => {
    setError('');
    try {
      await api.patch(`/leave/${id}/review`, { status, review_notes: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('leave.reviewFailed'));
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>{t('leave.reviewTitle')}</h1>
        <p>{t('leave.reviewSubtitle')}</p>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('kpi.employee')}</th>
                <th>{t('common.type')}</th>
                <th>{t('leave.start')}</th>
                <th>{t('leave.end')}</th>
                <th>{t('leave.days')}</th>
                <th>{t('leave.reason')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr><td colSpan={7} className="empty-state">{t('leave.noPendingRequests')}</td></tr>
              ) : requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.first_name} {r.last_name}</td>
                  <td>{labelFor(LEAVE_TYPE_KEYS, r.leave_type, t)}</td>
                  <td>{new Date(r.start_date).toLocaleDateString()}</td>
                  <td>{new Date(r.end_date).toLocaleDateString()}</td>
                  <td>{r.days_requested}</td>
                  <td>{r.reason || '—'}</td>
                  <td style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => handleReview(r.id, 'approved')}>{t('leave.approved_action')}</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleReview(r.id, 'rejected')}>{t('leave.rejected_action')}</button>
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
