import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import { CANDIDATE_STATUS_KEYS, VACANCY_STATUS_KEYS, labelFor } from '../utils/enumLabels';
import api from '../api/client';

const FILTERS = ['all', 'pending', 'hired', 'cancelled'];
const CANDIDATE_STATUSES = ['applied', 'shortlisted', 'interview', 'hired', 'rejected'];

export default function Vacancies() {
  const { t } = useLanguage();
  const [vacancies, setVacancies] = useState([]);
  const [filter, setFilter] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [candidates, setCandidates] = useState({});
  const [error, setError] = useState('');
  const [newForm, setNewForm] = useState({ title: '', department: '', position: '', description: '', requirements: '' });
  const [candForm, setCandForm] = useState({ name: '', email: '', phone: '' });

  const load = () => api.get('/vacancies').then((res) => setVacancies(res.data)).catch(console.error);
  useEffect(() => { load(); }, []);

  const toggleExpand = (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!candidates[id]) {
      api.get(`/vacancies/${id}`).then((res) => {
        setCandidates((prev) => ({ ...prev, [id]: res.data.candidates }));
      }).catch(console.error);
    }
  };

  const createVacancy = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/vacancies', newForm);
      setNewForm({ title: '', department: '', position: '', description: '', requirements: '' });
      setShowNew(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('vacancies.createFailed'));
    }
  };

  const setVacancyStatus = async (id, status) => {
    try {
      await api.patch(`/vacancies/${id}/status`, { status });
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('vacancies.updateFailed'));
    }
  };

  const refreshCandidates = (vacancyId) => {
    api.get(`/vacancies/${vacancyId}`).then((res) => {
      setCandidates((prev) => ({ ...prev, [vacancyId]: res.data.candidates }));
    }).catch(console.error);
  };

  const addCandidate = async (vacancyId, e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/vacancies/${vacancyId}/candidates`, candForm);
      setCandForm({ name: '', email: '', phone: '' });
      load();
      refreshCandidates(vacancyId);
    } catch (err) {
      setError(err.response?.data?.error || t('vacancies.addCandidateFailed'));
    }
  };

  const setCandidateStatus = async (vacancyId, candidateId, status) => {
    try {
      await api.patch(`/vacancies/${vacancyId}/candidates/${candidateId}/status`, { status });
      load();
      refreshCandidates(vacancyId);
    } catch (err) {
      setError(err.response?.data?.error || t('vacancies.updateCandidateFailed'));
    }
  };

  const filtered = filter === 'all' ? vacancies : vacancies.filter((v) => v.status === filter);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{t('vacancies.title')}</h1>
          <p>{t('vacancies.subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(!showNew)}>
          {showNew ? t('common.close') : `+ ${t('vacancies.newVacancy')}`}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {showNew && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{t('vacancies.newVacancy')}</h3>
          <form onSubmit={createVacancy}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div className="form-group">
                <label>{t('vacancies.jobTitle')} *</label>
                <input value={newForm.title} onChange={(e) => setNewForm({ ...newForm, title: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>{t('common.department')}</label>
                <input value={newForm.department} onChange={(e) => setNewForm({ ...newForm, department: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t('common.position')}</label>
                <input value={newForm.position} onChange={(e) => setNewForm({ ...newForm, position: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginTop: '16px' }}>
              <div className="form-group">
                <label>{t('vacancies.description')}</label>
                <textarea rows={3} value={newForm.description} onChange={(e) => setNewForm({ ...newForm, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t('vacancies.requirements')}</label>
                <textarea rows={3} value={newForm.requirements} onChange={(e) => setNewForm({ ...newForm, requirements: e.target.value })} />
              </div>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
              <button type="submit" className="btn btn-primary">{t('vacancies.createVacancy')}</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowNew(false)}>{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? t('common.all') : t(VACANCY_STATUS_KEYS[f])} {f !== 'all' && `(${vacancies.filter((v) => v.status === f).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card"><p className="empty-state">{t('vacancies.noVacanciesFound')}</p></div>
      ) : filtered.map((v) => (
        <div className="card" key={v.id} style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ marginBottom: '4px' }}>{v.title}</h3>
              <p style={{ color: '#6F8F73', fontSize: '0.875rem', marginBottom: '4px' }}>
                {[v.department, v.position].filter(Boolean).join(' • ') || t('vacancies.noDepartment')}
              </p>
              <p style={{ color: '#9DBB9E', fontSize: '0.8rem' }}>
                {t('vacancies.candidateCount', { count: v.candidate_count })} • {t('vacancies.hiredCount', { count: v.hired_count })}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className={`badge badge-${v.status}`}>{labelFor(VACANCY_STATUS_KEYS, v.status, t)}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => toggleExpand(v.id)}>
                {expandedId === v.id ? t('vacancies.hideCandidates') : t('vacancies.manageCandidates')}
              </button>
              {v.status !== 'hired' && (
                <button className="btn btn-primary btn-sm" onClick={() => setVacancyStatus(v.id, 'hired')}>{t('vacancies.markHired')}</button>
              )}
              {v.status !== 'cancelled' && (
                <button className="btn btn-danger btn-sm" onClick={() => setVacancyStatus(v.id, 'cancelled')}>{t('status.cancelled')}</button>
              )}
            </div>
          </div>

          {(v.description || v.requirements) && (
            <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
              {v.description && <p style={{ fontSize: '0.875rem', color: '#6F8F73' }}><strong>{t('vacancies.description')}:</strong> {v.description}</p>}
              {v.requirements && <p style={{ fontSize: '0.875rem', color: '#6F8F73' }}><strong>{t('vacancies.requirements')}:</strong> {v.requirements}</p>}
            </div>
          )}

          {expandedId === v.id && (
            <div style={{ marginTop: '16px', borderTop: '1px solid #ECEFF1', paddingTop: '16px' }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('common.name')}</th>
                      <th>{t('common.email')}</th>
                      <th>{t('common.phone')}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!candidates[v.id] || candidates[v.id].length === 0 ? (
                      <tr><td colSpan={5} className="empty-state">{t('vacancies.noCandidates')}</td></tr>
                    ) : candidates[v.id].map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td>{c.email || '—'}</td>
                        <td>{c.phone || '—'}</td>
                        <td><span className={`badge badge-${c.status}`}>{labelFor(CANDIDATE_STATUS_KEYS, c.status, t)}</span></td>
                        <td>
                          <select
                            value={c.status}
                            onChange={(e) => setCandidateStatus(v.id, c.id, e.target.value)}
                            style={{ padding: '6px 8px', border: '1px solid #CFD8DC', borderRadius: '6px' }}
                          >
                            {CANDIDATE_STATUSES.map((s) => (
                              <option key={s} value={s}>{t(CANDIDATE_STATUS_KEYS[s])}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form onSubmit={(e) => addCandidate(v.id, e)} style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', alignItems: 'end' }}>
                <div className="form-group">
                  <label>{t('vacancies.candidateName')} *</label>
                  <input value={candForm.name} onChange={(e) => setCandForm({ ...candForm, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>{t('common.email')}</label>
                  <input type="email" value={candForm.email} onChange={(e) => setCandForm({ ...candForm, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('common.phone')}</label>
                  <input value={candForm.phone} onChange={(e) => setCandForm({ ...candForm, phone: e.target.value })} />
                </div>
                <button type="submit" className="btn btn-primary">{t('vacancies.addCandidate')}</button>
              </form>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
