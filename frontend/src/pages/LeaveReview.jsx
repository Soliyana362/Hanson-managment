import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import { LEAVE_STATUS_KEYS, LEAVE_TYPE_KEYS, labelFor } from '../utils/enumLabels';
import LeaveRequestModal from '../components/LeaveRequestModal';
import api from '../api/client';

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'cancelled'];

export default function LeaveReview() {
  const { t, formatDate } = useLanguage();
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);

  const load = () => api.get('/leave').then((res) => setRequests(res.data)).catch(console.error);
  useEffect(() => { load(); }, []);

  const visible = filter === 'all' ? requests : requests.filter((r) => r.status === filter);

  const handleReview = async (id, status) => {
    setError('');
    setSuccess('');
    try {
      await api.patch(`/leave/${id}/review`, { status, review_notes: '' });
      setSuccess(status === 'approved' ? t('leave.approvedSuccess') : t('leave.rejectedSuccess'));
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('leave.reviewFailed'));
    }
  };

  const handleSaved = (saved) => {
    setModal(null);
    setError('');
    setSuccess(t('leave.savedSuccess'));
    load();
    return saved;
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1>{t('leave.reviewTitle')}</h1>
          <p>{t('leave.reviewSubtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
          + {t('leave.addForEmployee')}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {success && <div className="success-msg">{success}</div>}

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
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={8} className="empty-state">{t('leave.noPendingRequests')}</td></tr>
              ) : visible.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.first_name} {r.last_name}
                    {r.created_by && Number(r.created_by) !== Number(r.user_id) && (
                      <small className="form-hint">{t('leave.enteredBy')}: {r.creator_first_name} {r.creator_last_name}</small>
                    )}
                  </td>
                  <td>{labelFor(LEAVE_TYPE_KEYS, r.leave_type, t)}</td>
                  <td>{formatDate(r.start_date)}</td>
                  <td>{formatDate(r.end_date)}</td>
                  <td>{r.days_requested}</td>
                  <td>{r.reason || '—'}</td>
                  <td><span className={`badge badge-${r.status}`}>{labelFor(LEAVE_STATUS_KEYS, r.status, t)}</span></td>
                  <td style={{ display: 'flex', gap: '8px' }}>
                    {r.status === 'pending' && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => handleReview(r.id, 'approved')}>{t('leave.approved_action')}</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleReview(r.id, 'rejected')}>{t('leave.rejected_action')}</button>
                      </>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={() => setModal({ mode: 'edit', request: r })}>
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: '16px' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('common.filter')}</label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: '260px' }}>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? t('leave.allStatuses') : labelFor(LEAVE_STATUS_KEYS, s, t)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {modal && (
        <LeaveRequestModal
          mode={modal.mode}
          request={modal.request}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
