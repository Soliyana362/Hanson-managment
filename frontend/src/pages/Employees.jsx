import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import { EMPLOYMENT_STATUS_KEYS, GENDER_KEYS, ROLE_KEYS, labelFor } from '../utils/enumLabels';
import api from '../api/client';

export default function Employees() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [employees, setEmployees] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const canViewDetail = ['hr', 'admin', 'coo', 'manager'].includes(user?.role);
  const canDownload = ['hr', 'admin'].includes(user?.role);

  useEffect(() => {
    api.get('/users').then((res) => setEmployees(res.data)).catch(console.error);
  }, []);

  const downloadAnnualLeave = async () => {
    setDownloading(true);
    try {
      const res = await api.get('/users/annual-leave', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `annual-leave-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{t('employees.title')}</h1>
          <p>{t('employees.subtitle')}</p>
        </div>
        {canDownload && (
          <button className="btn btn-primary" onClick={downloadAnnualLeave} disabled={downloading}>
            {downloading ? t('employees.downloading') : t('employees.downloadAnnualLeave')}
          </button>
        )}
      </div>

      <div className="card">
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
                  <td>{canViewDetail && !(user?.role === 'hr' && e.role === 'coo') ? <Link to={`/employees/${e.id}`}>{e.first_name} {e.last_name}</Link> : <>{e.first_name} {e.last_name}</>}</td>
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
      </div>

    </div>
  );
}
