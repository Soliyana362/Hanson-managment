import { useLanguage } from '../i18n';
import { EMPLOYMENT_STATUS_KEYS, labelFor } from '../utils/enumLabels';

const STATUS_COLORS = {
  active: '#43A047',
  on_leave: '#FB8C00',
  inactive: '#9E9E9E',
};

export default function EmployeeStatusChart({ team }) {
  const { t } = useLanguage();
  if (!team) return null;

  const total = team.total_employees ?? 0;
  const byStatus = team.by_status ?? [];
  const byDepartment = team.by_department ?? [];

  let acc = 0;
  const segments = byStatus
    .filter((s) => s.count > 0)
    .map((s) => {
      const from = total ? (acc / total) * 360 : 0;
      acc += s.count;
      const to = total ? (acc / total) * 360 : 0;
      const color = STATUS_COLORS[s.status] || '#9DBB9E';
      return { ...s, color, from, to };
    });

  const maxDept = Math.max(1, ...byDepartment.map((d) => d.count));

  return (
    <div className="chart-grid">
      <div className="card chart-card">
        <h3>{t('statusChart.employeeStatus')}</h3>
        <div className="donut-wrap">
          <div
            className="donut"
            style={{
              background: segments.length
                ? `conic-gradient(${segments.map((s) => `${s.color} ${s.from}deg ${s.to}deg`).join(', ')})`
                : '#DCEADA',
            }}
          >
            <div className="donut-hole">
              <strong>{total}</strong>
              <span>{t('statusChart.employees')}</span>
            </div>
          </div>
          <div className="donut-legend">
            {byStatus.length === 0 && <div className="legend-item">{t('statusChart.noData')}</div>}
            {byStatus.map((s) => (
              <div className="legend-item" key={s.status}>
                <span className="legend-dot" style={{ background: STATUS_COLORS[s.status] || '#9DBB9E' }} />
                <span className="legend-label">{labelFor(EMPLOYMENT_STATUS_KEYS, s.status, t)}</span>
                <span className="legend-value">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card chart-card">
        <h3>{t('statusChart.byDepartment')}</h3>
        <div className="bar-chart">
          {byDepartment.length === 0 && <p className="empty-state">{t('statusChart.noData')}</p>}
          {byDepartment.map((d) => (
            <div className="bar-row" key={d.department_name}>
              <span className="bar-label">{d.department_name}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(d.count / maxDept) * 100}%` }} />
              </div>
              <span className="bar-value">{d.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
