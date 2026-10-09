import { useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import { GENDER_KEYS, labelFor } from '../utils/enumLabels';

const GENDER_VALUES = ['female', 'male', 'other', 'prefer_not_to_say'];

export default function EditProfileModal({ onClose }) {
  const { user, updateUser } = useAuth();
  const { t } = useLanguage();
  const [form, setForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    gender: user?.gender || '',
    age: user?.age ?? '',
    emergency_contact: user?.emergency_contact || '',
    education: user?.education || '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await api.put('/users/profile', form);
      updateUser(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || t('profile.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('profile.editProfile')}</h3>
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
              <label>{t('profile.firstName')}</label>
              <input
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>{t('profile.lastName')}</label>
              <input
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>{t('profile.email')}</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>{t('profile.phone')}</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>{t('profile.gender')}</label>
              <select
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
              >
                <option value="">{t('common.notSet')}</option>
                {GENDER_VALUES.map((v) => (
                  <option key={v} value={v}>{labelFor(GENDER_KEYS, v, t)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('profile.age')}</label>
              <input
                type="number"
                min="0"
                max="130"
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>{t('profile.emergencyContact')}</label>
              <input
                value={form.emergency_contact}
                onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>{t('profile.educationalBackground')}</label>
              <input
                value={form.education}
                onChange={(e) => setForm({ ...form, education: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : t('profile.saveChanges')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
