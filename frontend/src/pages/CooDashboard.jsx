import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { EDUCATION_KEYS, EMPLOYMENT_STATUS_KEYS, GENDER_KEYS, ROLE_KEYS, labelFor } from '../utils/enumLabels';
import api from '../api/client';

const AGE_GROUPS = [
  { key: 'under30', match: (age) => age < 30 },
  { key: 'age30to44', match: (age) => age >= 30 && age <= 44 },
  { key: 'age45plus', match: (age) => age >= 45 },
];

// Stored values stay English so the existing sort order keeps working.
const EDUCATION_ORDER = ['High School', 'Certificate', 'Diploma', "Bachelor's Degree", "Master's Degree", 'PhD'];

function formatPercent(count, total, formatNumber) {
  if (!total) return '0%';
  return formatNumber((count / total) * 100, { maximumFractionDigits: 1 }) + '%';
}

function toDistribution(counts, total, formatNumber) {
  return counts.map((item) => ({
    ...item,
    percent: formatPercent(item.count, total, formatNumber),
    width: total ? `${(item.count / total) * 100}%` : '0%',
  }));
}

function DistributionCard({ title, rows }) {
  return (
    <div className="card">
      <h3 style={{ marginBottom: '16px', color: '#2E7D32' }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {rows.map((row) => (
          <div key={row.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '6px', fontSize: '0.9rem' }}>
              <span style={{ color: '#1B5E20', fontWeight: 600 }}>{row.label}</span>
              <span style={{ color: '#2E7D32', fontWeight: 700 }}>{row.percent}</span>
            </div>
            <div style={{ height: '8px', background: '#EAF3EC', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{ width: row.width, height: '100%', minWidth: row.count ? '4px' : 0, background: row.color || '#4CAF50', borderRadius: '999px' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CooDashboard() {
  const { t, formatNumber } = useLanguage();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/users')
      .then((res) => setEmployees(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const active = employees.filter((e) => e.status === 'active').length;
  const onLeave = employees.filter((e) => e.status === 'on_leave').length;
  const total = employees.length;
  const genderRows = toDistribution([
    { label: t('employees.female'), count: employees.filter((e) => e.gender === 'female').length, color: '#2E7D32' },
    { label: t('employees.male'), count: employees.filter((e) => e.gender === 'male').length, color: '#1976D2' },
    { label: t('employees.other'), count: employees.filter((e) => e.gender === 'other').length, color: '#7B1FA2' },
    { label: t('employees.preferNotToSay'), count: employees.filter((e) => e.gender === 'prefer_not_to_say').length, color: '#6F8F73' },
    { label: t('common.unknown'), count: employees.filter((e) => !e.gender).length, color: '#90A4AE' },
  ].filter((row) => row.count > 0 || total === 0), total, formatNumber);
  const ageRows = toDistribution([
    ...AGE_GROUPS.map((group) => ({
      label: t(`coo.${group.key}`),
      count: employees.filter((e) => {
        const age = Number(e.age);
        return Number.isFinite(age) && group.match(age);
      }).length,
    })),
    { label: t('common.unknown'), count: employees.filter((e) => !Number.isFinite(Number(e.age))).length, color: '#90A4AE' },
  ].filter((row) => row.count > 0 || total === 0), total, formatNumber);
  const educationValues = Array.from(new Set([
    ...EDUCATION_ORDER,
    ...employees.map((e) => e.education).filter(Boolean),
  ]));
  const knowledgeRows = toDistribution([
    ...educationValues.map((education) => ({
      label: labelFor(EDUCATION_KEYS, education, t),
      count: employees.filter((e) => e.education === education).length,
      color: education === "Master's Degree" || education === 'PhD' ? '#2E7D32' : '#4CAF50',
    })),
    { label: t('common.unknown'), count: employees.filter((e) => !e.education).length, color: '#90A4AE' },
  ].filter((row) => row.count > 0 || total === 0), total, formatNumber);

  return (
    <div>
      <div className="page-header">
        <h1>{t('coo.title')}</h1>
        <p>{t('coo.subtitle')}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ fontSize: '2rem', margin: 0, color: '#2E7D32' }}>{formatNumber(employees.length)}</h3>
          <p style={{ color: '#6F8F73', margin: 0 }}>{t('coo.totalEmployees')}</p>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ fontSize: '2rem', margin: 0, color: '#2E7D32' }}>{formatNumber(active)}</h3>
          <p style={{ color: '#6F8F73', margin: 0 }}>{t('coo.active')}</p>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ fontSize: '2rem', margin: 0, color: '#2E7D32' }}>{formatNumber(onLeave)}</h3>
          <p style={{ color: '#6F8F73', margin: 0 }}>{t('coo.onLeave')}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <DistributionCard title={t('coo.genderRatio')} rows={genderRows} />
        <DistributionCard title={t('coo.ageGroups')} rows={ageRows} />
        <DistributionCard title={t('coo.knowledgeStatus')} rows={knowledgeRows} />
      </div>

      <div className="card">
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('common.email')}</th>
                  <th>{t('common.department')}</th>
                  <th>{t('common.position')}</th>
                  <th>{t('employees.gender')}</th>
                  <th>{t('employees.age')}</th>
                  <th>{t('common.role')}</th>
                  <th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td><Link to={`/employees/${e.id}`}>{e.first_name} {e.last_name}</Link></td>
                    <td>{e.email}</td>
                    <td>{e.department_name || '—'}</td>
                    <td>{e.position || '—'}</td>
                    <td>{labelFor(GENDER_KEYS, e.gender, t)}</td>
                    <td>{e.age ?? '—'}</td>
                    <td>{labelFor(ROLE_KEYS, e.role, t)}</td>
                    <td><span className={`badge badge-${e.status}`}>{labelFor(EMPLOYMENT_STATUS_KEYS, e.status, t)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
