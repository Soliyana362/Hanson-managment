import { useLanguage } from '../i18n';
import { displayPeriodLabel } from '../utils/periodLabel';

function barColor(score) {
  if (score >= 4.5) return '#43A047';
  if (score >= 3.5) return '#7CB342';
  if (score >= 2.5) return '#FB8C00';
  return '#E53935';
}

export default function PerformanceChart({ history, keepRawPeriodLabel = false }) {
  const { t, locale } = useLanguage();
  const data = Array.isArray(history) ? [...history].reverse() : [];

  if (data.length === 0) {
    return <p className="empty-state">{t('performanceChart.noData')}</p>;
  }

  const maxScore = 5;
  const W = 640;
  const H = 240;
  const padL = 36;
  const padR = 12;
  const padT = 24;
  const padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const slot = chartW / data.length;
  const barW = Math.min(56, slot * 0.55);

  const gridlines = [0, 1, 2, 3, 4, 5];

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: '420px', maxWidth: '760px', display: 'block' }}>
        {gridlines.map((g) => {
          const y = padT + chartH - (g / maxScore) * chartH;
          return (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#DCEADA" strokeWidth="1" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#9DBB9E">{g}</text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const score = Number(d.total_weighted_score) || 0;
          const periodLabel = displayPeriodLabel(d.period_label, keepRawPeriodLabel, { locale, t });
          const barH = (Math.min(Math.max(score, 0), maxScore) / maxScore) * chartH;
          const x = padL + i * slot + (slot - barW) / 2;
          const y = padT + chartH - barH;
          const color = barColor(score);
          return (
            <g key={d.period_label + i}>
              <rect x={x} y={y} width={barW} height={barH} rx="4" fill={color} />
              <text x={x + barW / 2} y={y - 8} textAnchor="middle" fontSize="12" fontWeight="700" fill="#263238">
                {Number(score.toFixed(2))}
              </text>
              <text x={x + barW / 2} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#6F8F73">
                {periodLabel.length > 14 ? `${periodLabel.slice(0, 13)}...` : periodLabel}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '8px', fontSize: '0.8rem', color: '#6F8F73' }}>
        <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: '#43A047', marginRight: '4px' }} />{t('performanceChart.excellent')}</span>
        <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: '#7CB342', marginRight: '4px' }} />{t('performanceChart.good')}</span>
        <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: '#FB8C00', marginRight: '4px' }} />{t('performanceChart.fair')}</span>
        <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: '#E53935', marginRight: '4px' }} />{t('performanceChart.needsImprovement')}</span>
      </div>
    </div>
  );
}
