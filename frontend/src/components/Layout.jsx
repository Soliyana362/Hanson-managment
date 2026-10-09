import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import api from '../api/client';
import LanguageSwitcher from './LanguageSwitcher';
import './Layout.css';

function timeAgo(dateStr) {
  const date = new Date((dateStr || '').replace(' ', 'T') + 'Z');
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const isManager = ['hr', 'admin', 'manager'].includes(user?.role);
  const isHr = ['hr', 'admin'].includes(user?.role);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordForm, setChangePasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordSuccess, setChangePasswordSuccess] = useState('');
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoRemoving, setPhotoRemoving] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [photoSuccess, setPhotoSuccess] = useState('');
  const [profilePhoto, setProfilePhoto] = useState(null);
  const fileInputRef = useRef(null);
  const bellRef = useRef(null);

  const loadPhoto = () => {
    if (!user?.id) return;
    api.get(`/uploads?userId=${user.id}`)
      .then((res) => {
        const photo = res.data.find((d) => d.category === 'profile_photo');
        if (!photo) { setPhotoUrl(null); setProfilePhoto(null); return; }
        setProfilePhoto(photo);
        return api.get(`/uploads/file/${photo.id}`, { responseType: 'blob' })
          .then((fr) => setPhotoUrl(URL.createObjectURL(fr.data)))
          .catch(() => setPhotoUrl(null));
      })
      .catch(() => setPhotoUrl(null));
  };
  useEffect(() => {
    loadPhoto();
  }, [user?.id]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, []);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUploading(true);
    setPhotoError('');
    setPhotoSuccess('');
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('userId', user.id);
    try {
      await api.post('/uploads/photo', fd);
      loadPhoto();
      setPhotoSuccess(t('profile.photoUploaded'));
    } catch (err) {
      setPhotoError(err.response?.data?.error || t('files.photoFailed'));
    } finally {
      setPhotoUploading(false);
    }
  };

  const handlePhotoRemove = async () => {
    if (!profilePhoto) return;
    setPhotoRemoving(true);
    setPhotoError('');
    setPhotoSuccess('');
    try {
      await api.delete(`/uploads/${profilePhoto.id}`);
      setPhotoUrl(null);
      setProfilePhoto(null);
      loadPhoto();
      setPhotoSuccess(t('profile.photoRemoved'));
    } catch (err) {
      setPhotoError(err.response?.data?.error || t('profile.removePhotoFailed'));
    } finally {
      setPhotoRemoving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setChangePasswordError('');
    setChangePasswordSuccess('');
    if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
      return setChangePasswordError(t('profile.passwordsDoNotMatch'));
    }
    setChangePasswordLoading(true);
    try {
      const res = await api.post('/auth/change-password', {
        currentPassword: changePasswordForm.currentPassword,
        newPassword: changePasswordForm.newPassword,
      });
      setChangePasswordSuccess(res.data.message);
      setChangePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => setShowChangePassword(false), 2000);
    } catch (err) {
      setChangePasswordError(err.response?.data?.error || t('profile.passwordChangeFailed'));
    } finally {
      setChangePasswordLoading(false);
    }
  };

  const loadNotifs = () => {
    api.get('/notifications').then((res) => setNotifs(res.data)).catch(() => {});
  };
  useEffect(() => {
    loadNotifs();
    const id = setInterval(loadNotifs, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setShowNotifs(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  useEffect(() => {
    const close = () => { if (window.innerWidth > 768) setSidebarOpen(false); };
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, []);

  const unread = notifs.filter((n) => !n.is_read).length;

  const markRead = async (n) => {
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
    await api.patch(`/notifications/${n.id}/read`).catch(() => {});
    if (n.link) {
      setShowNotifs(false);
      navigate(n.link);
    }
  };

  const markAllRead = async () => {
    setNotifs((prev) => prev.map((x) => ({ ...x, is_read: 1 })));
    await api.patch('/notifications/read-all').catch(() => {});
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`} onClick={() => setSidebarOpen(false)}>
        <div className="sidebar-brand">
          <img src="/hanson-logo.png" alt="Hanson" className="brand-logo" />
          <div>
            <h2>Hanson</h2>
          </div>
        </div>

        <nav className="sidebar-nav">
          {user?.role !== 'coo' && (
            <>
              <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t('nav.dashboard')}
              </NavLink>
              <NavLink to="/my-status" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t('nav.myStatus')}
              </NavLink>
              <NavLink to="/leave" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t('nav.leave')}
              </NavLink>
            </>
          )}
          <NavLink to="/kpi" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            {t('nav.kpiReviews')}
          </NavLink>
          {isManager && (
            <>
              <div className="nav-divider">{t('nav.management')}</div>
              <NavLink to="/employees" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t('nav.employees')}
              </NavLink>
              <NavLink to="/leave/review" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t('nav.reviewLeave')}
              </NavLink>
              <NavLink to="/kpi/templates" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t('nav.kpiTemplates')}
              </NavLink>
              <NavLink to="/kpi/new" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t('nav.newKpi')}
              </NavLink>
            </>
          )}
          {isHr && (
            <>
              <div className="nav-divider">{t('nav.hr')}</div>
              <NavLink to="/vacancies" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t('nav.hiring')}
              </NavLink>
            </>
          )}
          {user?.role === 'coo' && (
            <>
              <div className="nav-divider">{t('nav.executive')}</div>
              <NavLink to="/coo" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t('nav.cooDashboard')}
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info" onClick={() => setShowProfileSettings(true)} style={{ cursor: 'pointer' }}>
            <div className="user-avatar-wrap">
              {photoUrl ? (
                <img src={photoUrl} alt={t('profile.profilePhoto')} className="user-avatar-photo" />
              ) : (
                <div className="user-avatar">{user?.first_name?.[0]}{user?.last_name?.[0]}</div>
              )}
            </div>
            <div>
              <strong>{user?.first_name} {user?.last_name}</strong>
              <span>{t(`roles.${user?.role}`)}</span>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm logout-btn" onClick={handleLogout}>
            {t('header.signOut')}
          </button>
        </div>
      </aside>

      <button
        type="button"
        className={`sidebar-backdrop${sidebarOpen ? ' sidebar-backdrop--visible' : ''}`}
        aria-label={t('nav.closeMenu')}
        onClick={() => setSidebarOpen(false)}
      />

      <main className="main-content">
        <div className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-toggle"
              aria-label={t('nav.menu')}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
          <div className="topbar-right">
            <LanguageSwitcher compact />
            <div className="notif-bell" ref={bellRef}>
              <button className="bell-btn" onClick={() => setShowNotifs(!showNotifs)} aria-label={t('header.notifications')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unread > 0 && <span className="notif-badge">{unread}</span>}
              </button>
              {showNotifs && (
                <div className="notif-dropdown">
                  <div className="notif-header">
                    <strong>{t('header.notifications')}</strong>
                    {unread > 0 && (
                      <button className="notif-mark-all" onClick={markAllRead}>{t('header.markAllRead')}</button>
                    )}
                  </div>
                  <div className="notif-list">
                    {notifs.length === 0 && <div className="notif-empty">{t('header.noNotifications')}</div>}
                    {notifs.map((n) => (
                      <div key={n.id} className={`notif-item${n.is_read ? '' : ' unread'}`} onClick={() => markRead(n)}>
                        <div className="notif-title">{n.title}</div>
                        <div className="notif-msg">{n.message}</div>
                        <div className="notif-time">{timeAgo(n.created_at)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {children}
        <footer className="site-footer">
          <span>&copy; {new Date().getFullYear()} Hanson HR Management</span>
          <Link to="/terms">{t('login.terms')}</Link>
          <Link to="/privacy">{t('login.privacy')}</Link>
        </footer>
      </main>

      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('header.signOut')}</h3>
              <button className="modal-close" onClick={() => setShowLogoutConfirm(false)} aria-label={t('common.close')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p style={{ color: '#6F8F73' }}>{t('header.logoutConfirm')}</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-primary" onClick={confirmLogout}>{t('header.yesSignOut')}</button>
              <button className="btn btn-secondary" onClick={() => setShowLogoutConfirm(false)}>{t('header.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {showProfileSettings && (
        <div className="modal-overlay" onClick={() => { setShowProfileSettings(false); setShowChangePassword(false); }}>
          <div className="modal modal-profile" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('profile.title')}</h3>
              <button className="modal-close" onClick={() => { setShowProfileSettings(false); setShowChangePassword(false); }} aria-label={t('common.close')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {!showChangePassword && (
              <>
                <div className="profile-photo-section">
                  <div className="profile-photo-large">
                    {photoUrl ? (
                      <img src={photoUrl} alt={t('profile.profilePhoto')} className="profile-photo-large-img" />
                    ) : (
                      <div className="profile-photo-large-initials">{user?.first_name?.[0]}{user?.last_name?.[0]}</div>
                    )}
                  </div>
                  {photoError && <div className="error-msg" style={{ marginBottom: '10px' }}>{photoError}</div>}
                  {photoSuccess && <div className="success-msg" style={{ marginBottom: '10px' }}>{photoSuccess}</div>}
                  <div className="profile-photo-actions">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handlePhotoUpload}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={photoUploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {photoUploading ? t('common.uploading') : (photoUrl ? t('profile.updatePhoto') : t('profile.uploadPhoto'))}
                    </button>
                    {photoUrl && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={photoRemoving}
                        onClick={handlePhotoRemove}
                      >
                        {photoRemoving ? t('common.removing') : t('profile.removePhoto')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="profile-info-section">
                  <div className="profile-field"><strong>{t('common.name')}:</strong> {user?.first_name} {user?.last_name}</div>
                  <div className="profile-field"><strong>{t('common.email')}:</strong> {user?.email}</div>
                  <div className="profile-field"><strong>{t('common.role')}:</strong> {t(`roles.${user?.role}`)}</div>
                  <div className="profile-field"><strong>{t('common.position')}:</strong> {user?.position || '—'}</div>
                  <div className="profile-field"><strong>{t('common.department')}:</strong> {user?.department_name || '—'}</div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => { setChangePasswordError(''); setChangePasswordSuccess(''); setShowChangePassword(true); }}
                  >
                    {t('header.changePassword')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => { setShowProfileSettings(false); setShowChangePassword(false); }}
                  >
                    {t('common.close')}
                  </button>
                </div>
              </>
            )}

            {showChangePassword && (
              <form onSubmit={handleChangePassword}>
                <div className="form-group">
                  <label>{t('profile.currentPassword')}</label>
                  <input type="password" value={changePasswordForm.currentPassword} onChange={(e) => setChangePasswordForm({ ...changePasswordForm, currentPassword: e.target.value })} required placeholder={t('profile.currentPasswordPlaceholder')} />
                </div>
                <div className="form-group">
                  <label>{t('profile.newPassword')}</label>
                  <input type="password" value={changePasswordForm.newPassword} onChange={(e) => setChangePasswordForm({ ...changePasswordForm, newPassword: e.target.value })} required placeholder={t('profile.minCharacters')} />
                </div>
                <div className="form-group">
                  <label>{t('profile.confirmNewPassword')}</label>
                  <input type="password" value={changePasswordForm.confirmPassword} onChange={(e) => setChangePasswordForm({ ...changePasswordForm, confirmPassword: e.target.value })} required placeholder={t('profile.confirmPasswordPlaceholder')} />
                </div>
                {changePasswordError && <div className="error-msg">{changePasswordError}</div>}
                {changePasswordSuccess && <div className="success-msg">{changePasswordSuccess}</div>}
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button type="submit" className="btn btn-primary" disabled={changePasswordLoading}>
                    {changePasswordLoading ? t('profile.saving') : t('profile.savePassword')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => { setShowChangePassword(false); setChangePasswordError(''); setChangePasswordSuccess(''); }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
