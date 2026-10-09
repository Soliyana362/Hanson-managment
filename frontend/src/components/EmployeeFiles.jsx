import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import EditProfileModal from './EditProfileModal';

export default function EmployeeFiles({ userId, readonly = false, hidePhoto = false }) {
  const { user } = useAuth();
  const { t, formatDate, formatNumber } = useLanguage();
  const isHr = ['hr', 'admin'].includes(user?.role);
  const isOwner = user?.id === userId;
  const canEditPhoto = !readonly && (isHr || isOwner);
  const canEditProfile = !readonly && (isHr || isOwner);
  const canEditDocs = !readonly && isHr;
  const [docs, setDocs] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingDocId, setEditingDocId] = useState(null);
  const photoInputRef = useRef(null);
  const docInputRef = useRef(null);
  const docEditInputRef = useRef(null);

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return t('files.sizeBytes', { count: bytes });
    if (bytes < 1024 * 1024) return t('files.sizeKb', { size: formatNumber(bytes / 1024, { maximumFractionDigits: 1 }) });
    return t('files.sizeMb', { size: formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 }) });
  };

  useEffect(() => {
    let revokeUrl = null;
    let cancelled = false;
    setPhoto(null);
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    api
      .get('/uploads', { params: { userId } })
      .then(async (res) => {
        if (cancelled) return;
        const list = res.data;
        setDocs(list.filter((d) => d.category !== 'profile_photo'));
        const p = list.find((d) => d.category === 'profile_photo');
        setPhoto(p || null);
        if (p) {
          const blobRes = await api.get(`/uploads/file/${p.id}`, { responseType: 'blob' });
          if (cancelled) return;
          const url = URL.createObjectURL(blobRes.data);
          revokeUrl = url;
          setPhotoUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('files.loadFailed'));
      });

    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [userId]);

  const reload = () => {
    api
      .get('/uploads', { params: { userId } })
      .then((res) => {
        setDocs(res.data.filter((d) => d.category !== 'profile_photo'));
        setPhoto(res.data.find((d) => d.category === 'profile_photo') || null);
      })
      .catch(() => setError(t('files.refreshFailed')));
  };

  const refreshPhotoUrl = async (photoDoc) => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    if (!photoDoc) return;
    const blobRes = await api.get(`/uploads/file/${photoDoc.id}`, { responseType: 'blob' });
    setPhotoUrl(URL.createObjectURL(blobRes.data));
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    setError('');
    setBusy(true);
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('userId', userId);
    try {
      await api.post('/uploads/photo', fd);
      const res = await api.get('/uploads', { params: { userId } });
      const p = res.data.find((d) => d.category === 'profile_photo') || null;
      setPhoto(p);
      await refreshPhotoUrl(p);
    } catch (err) {
      setError(err.response?.data?.error || t('files.photoFailed'));
    } finally {
      setBusy(false);
    }
  };

  const uploadDocument = async (file) => {
    if (!file) return;
    setError('');
    setBusy(true);
    const fd = new FormData();
    fd.append('document', file);
    fd.append('userId', userId);
    try {
      await api.post('/uploads/document', fd);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || t('files.documentFailed'));
    } finally {
      setBusy(false);
    }
  };

  const startEditDocument = (doc) => {
    setEditingDocId(doc.id);
    setError('');
    docEditInputRef.current?.click();
  };

  const replaceDocument = async (file) => {
    if (!file || !editingDocId) return;
    setError('');
    setBusy(true);
    const fd = new FormData();
    fd.append('document', file);
    try {
      await api.put(`/uploads/document/${editingDocId}`, fd);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || t('files.editFailed'));
    } finally {
      setBusy(false);
      setEditingDocId(null);
    }
  };

  const download = async (doc) => {
    try {
      const res = await api.get(`/uploads/file/${doc.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(t('files.downloadFailed'));
    }
  };

  const view = (doc) => {
    // Letters are HTML and render in a tab; every other file is served as an
    // attachment, so the browser downloads it instead.
    const kind = doc.mime_type === 'text/html' ? 'letter' : 'file';
    const url = `${api.defaults.baseURL}/uploads/${kind}/${doc.id}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const remove = async (doc) => {
    setError('');
    try {
      await api.delete(`/uploads/${doc.id}`);
      if (doc.category === 'profile_photo') {
        setPhoto(null);
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        setPhotoUrl(null);
      } else {
        reload();
      }
    } catch (err) {
      setError(err.response?.data?.error || t('files.deleteFailed'));
    }
  };

  return (
    <div className={`grid-photo${hidePhoto ? ' grid-photo--no-photo' : ''}`}>
      {!hidePhoto && (
        <div className="card">
          <h3 style={{ marginBottom: '12px', color: '#2E7D32' }}>{t('profile.profilePhoto')}</h3>
          <div
            onClick={() => canEditProfile && setShowEdit(true)}
            title={canEditProfile ? t('files.clickToEdit') : undefined}
            style={{
              width: 140,
              height: 140,
              borderRadius: '50%',
              background: '#ECEFF1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              marginBottom: '12px',
              border: '2px solid #CFD8DC',
              cursor: canEditProfile ? 'pointer' : 'default',
            }}
          >
            {photoUrl ? (
              <img src={photoUrl} alt={t('profile.profilePhoto')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#9DBB9E', fontSize: '0.875rem', textAlign: 'center', padding: '8px' }}>
                {t('files.noPhoto')}
              </span>
            )}
          </div>
          {canEditProfile && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {canEditPhoto && (
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    uploadPhoto(e.target.files[0]);
                    e.target.value = '';
                  }}
                />
              )}
              {canEditPhoto && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => photoInputRef.current?.click()}
                >
                  {photo ? t('profile.updatePhoto') : t('profile.uploadPhoto')}
                </button>
              )}
              {canEditPhoto && photo && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(photo)}>
                  {t('common.delete')}
                </button>
              )}
            </div>
          )}
          {error && <div className="error-msg" style={{ marginTop: '10px' }}>{error}</div>}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ color: '#2E7D32' }}>{t('employeeDetail.documents')}</h3>
          {canEditDocs && (
            <>
              <input
                ref={docInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  uploadDocument(e.target.files[0]);
                  e.target.value = '';
                }}
              />
              <input
                ref={docEditInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  replaceDocument(e.target.files[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => docInputRef.current?.click()}
              >
                + {t('files.uploadDocument')}
              </button>
            </>
          )}
        </div>

        {docs.length === 0 ? (
          <p className="empty-state">{canEditDocs ? t('files.noDocumentsHr') : t('files.noDocuments')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('files.size')}</th>
                  <th>{t('files.uploaded')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td style={{ wordBreak: 'break-all' }}>{d.original_name}</td>
                    <td>{formatSize(d.size_bytes)}</td>
                    <td>{formatDate(d.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        {canEditDocs && (
                          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => startEditDocument(d)}>
                            {t('common.edit')}
                          </button>
                        )}
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => view(d)}>
                          {t('files.view')}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => download(d)}>
                          {t('files.download')}
                        </button>
                        {canEditDocs && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(d)}>
                            {t('common.delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showEdit && <EditProfileModal onClose={() => setShowEdit(false)} />}
    </div>
  );
}
