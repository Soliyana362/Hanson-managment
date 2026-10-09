import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import api from '../api/client';

// Lets HR add or correct the Amharic display copy for a template they imported,
// without re-uploading the spreadsheet. English stays the source of truth and is
// shown beside each field; clearing an input falls back to it.
export default function KpiTranslationEditor({ template, onSaved }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name_am: '', role_title_am: '', items: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || !template) return;
    api
      .get(`/kpi/templates/${template.id}`)
      .then(({ data }) => {
        setDraft({
          name_am: data.name_am || '',
          role_title_am: data.role_title_am || '',
          items: (data.items || []).map((item) => ({
            id: item.id,
            english: item.name,
            englishDefinition: item.definition,
            name_am: item.name_am || '',
            definition_am: item.definition_am || '',
            rating_criteria_am: item.rating_criteria_am || '',
          })),
        });
        setError('');
      })
      .catch((err) => setError(err.response?.data?.error || t('kpi.translationLoadFailed')));
  }, [open, template, t]);

  if (!template) return null;

  const setField = (field, value) => {
    setSaved(false);
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const setItemField = (index, field, value) => {
    setSaved(false);
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.put(`/kpi/templates/${template.id}/translation`, {
        name_am: draft.name_am,
        role_title_am: draft.role_title_am,
        items: draft.items.map(({ id, name_am, definition_am, rating_criteria_am }) => ({
          id,
          name_am,
          definition_am,
          rating_criteria_am,
        })),
      });
      setSaved(true);
      onSaved?.(data);
    } catch (err) {
      setError(err.response?.data?.error || t('kpi.translationSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div style={{ marginTop: '16px' }}>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          {t('kpi.editTranslation')}
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #E3EDE5' }}>
      <p style={{ marginBottom: '12px', color: '#6F8F73', fontSize: '0.85rem' }}>{t('kpi.translationHelp')}</p>

      {error && <div className="error-msg">{error}</div>}

      <div className="form-group">
        <label>{t('kpi.translationTemplateName')}</label>
        <input value={draft.name_am} onChange={(e) => setField('name_am', e.target.value)} maxLength={200} />
      </div>
      <div className="form-group">
        <label>{t('kpi.translationRoleTitle')}</label>
        <input value={draft.role_title_am} onChange={(e) => setField('role_title_am', e.target.value)} maxLength={150} />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('kpi.translationEnglish')}</th>
              <th>{t('kpi.translationAmharic')}</th>
              <th>{t('kpi.translationDefinition')}</th>
              <th>{t('kpi.translationCriteria')}</th>
            </tr>
          </thead>
          <tbody>
            {draft.items.map((item, index) => (
              <tr key={item.id}>
                <td style={{ fontSize: '0.85rem', color: '#6F8F73', minWidth: '160px' }}>
                  {item.english}
                  {item.englishDefinition && (
                    <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>{item.englishDefinition}</div>
                  )}
                </td>
                <td>
                  <input
                    value={item.name_am}
                    onChange={(e) => setItemField(index, 'name_am', e.target.value)}
                    maxLength={300}
                    style={{ width: '100%' }}
                  />
                </td>
                <td>
                  <input
                    value={item.definition_am}
                    onChange={(e) => setItemField(index, 'definition_am', e.target.value)}
                    maxLength={2000}
                    style={{ width: '100%' }}
                  />
                </td>
                <td>
                  <input
                    value={item.rating_criteria_am}
                    onChange={(e) => setItemField(index, 'rating_criteria_am', e.target.value)}
                    maxLength={1000}
                    style={{ width: '100%' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '16px', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? t('common.saving') : t('kpi.saveTranslation')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={saving}>
          {t('common.cancel')}
        </button>
        {saved && <span className="success-msg" style={{ margin: 0 }}>{t('kpi.translationSaved')}</span>}
      </div>
    </div>
  );
}
