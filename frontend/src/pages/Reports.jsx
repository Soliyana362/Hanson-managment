import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';
import api from '../api/client';
import './Reports.css';

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_QUARTER = Math.floor(new Date().getMonth() / 3) + 1;

function monthsForQuarter(quarter) {
  const firstMonth = (Number(quarter) - 1) * 3 + 1;
  return [String(firstMonth), String(firstMonth + 1), String(firstMonth + 2)];
}

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Reports() {
  const { user } = useAuth();
  const { t, locale } = useLanguage();
  const fileInput = useRef(null);
  const canUpload = ['employee', 'manager'].includes(user?.role);
  const canSeeTeam = ['manager', 'coo'].includes(user?.role);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  const [reportType, setReportType] = useState('quarterly');
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [quarter, setQuarter] = useState(String(CURRENT_QUARTER));
  const [months, setMonths] = useState(() => monthsForQuarter(CURRENT_QUARTER));
  const [file, setFile] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');

  const loadReports = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.get('/reports');
      setReports(response.data);
    } catch (err) {
      setLoadError(err.response?.data?.error || t('reports.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const years = useMemo(
    () => [...new Set(reports.map((report) => Number(report.report_year)))].sort((a, b) => b - a),
    [reports]
  );
  const filteredReports = reports.filter((report) => (
    (typeFilter === 'all' || report.report_type === typeFilter)
    && (yearFilter === 'all' || Number(report.report_year) === Number(yearFilter))
  ));

  const monthName = (monthNumber) => {
    const monthLocale = locale.startsWith('am') ? 'am-ET-u-ca-gregory' : locale;
    const formatter = new Intl.DateTimeFormat(monthLocale, { month: 'short', timeZone: 'UTC' });
    return formatter.format(new Date(Date.UTC(2025, Number(monthNumber) - 1, 1)));
  };

  const reportPeriod = (report) => {
    if (report.report_type !== 'quarterly') return String(report.report_year);
    const reportMonths = String(report.report_months || '').split(',').filter(Boolean);
    const monthRange = reportMonths.length === 3
      ? `${monthName(reportMonths[0])}–${monthName(reportMonths[2])}`
      : reportMonths.map(monthName).join(', ');
    const label = t('reports.quarterLabel', { quarter: report.report_quarter });
    return `${label}${monthRange ? ` (${monthRange})` : ''} ${report.report_year}`;
  };

  const handleQuarterChange = (value) => {
    setQuarter(value);
    setMonths(monthsForQuarter(value));
  };

  const uploadedDate = (value) => {
    const dateValue = String(value || '').replace(' ', 'T');
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    setUploadError('');
    setUploadSuccess('');
    if (!file) {
      setUploadError(t('reports.chooseFile'));
      return;
    }
    if (reportType === 'quarterly' && (
      months.length !== 3
      || months.some((monthValue, index) => Number(monthValue) !== Number(months[0]) + index)
      || Number(months[0]) < 1
      || Number(months[2]) > 12
    )) {
      setUploadError(t('reports.monthsConsecutiveError'));
      return;
    }

    const formData = new FormData();
    formData.append('reportType', reportType);
    formData.append('year', year);
    if (reportType === 'quarterly') {
      formData.append('quarter', quarter);
      formData.append('months', months.join(','));
    }
    formData.append('report', file);

    setUploading(true);
    try {
      await api.post('/reports', formData);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setUploadSuccess(t('reports.uploadSuccess'));
      await loadReports();
    } catch (err) {
      setUploadError(err.response?.data?.error || t('reports.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const downloadReport = async (report) => {
    try {
      const response = await api.get(`/reports/${report.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = report.original_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setLoadError(err.response?.data?.error || t('reports.downloadFailed'));
    }
  };

  const reportTitle = canSeeTeam ? t('reports.teamTitle') : t('reports.listTitle');

  return (
    <div className="reports-page">
      <div className="page-header">
        <div>
          <h1>{t('reports.title')}</h1>
          <p>{t('reports.subtitle')}</p>
        </div>
      </div>

      {canUpload && (
        <section className="card report-upload-card">
          <div className="report-section-heading">
            <h2>{t('reports.submitTitle')}</h2>
            <p>{t('reports.replaceHint')}</p>
          </div>
          <form onSubmit={handleUpload}>
            <div className="report-form-grid">
              <div className="form-group">
                <label htmlFor="report-type">{t('reports.type')}</label>
                <select id="report-type" value={reportType} onChange={(event) => setReportType(event.target.value)}>
                  <option value="quarterly">{t('reports.quarterly')}</option>
                  <option value="annual">{t('reports.annual')}</option>
                </select>
              </div>
              {reportType === 'quarterly' && (
                <>
                  <div className="form-group">
                    <label htmlFor="report-quarter">{t('reports.quarter')}</label>
                    <select id="report-quarter" value={quarter} onChange={(event) => handleQuarterChange(event.target.value)}>
                      {[1, 2, 3, 4].map((quarterNumber) => (
                        <option key={quarterNumber} value={quarterNumber}>
                          {t('reports.quarterLabel', { quarter: quarterNumber })}
                        </option>
                      ))}
                    </select>
                  </div>
                  {months.map((monthValue, index) => (
                    <div className="form-group" key={index}>
                      <label htmlFor={`report-month-${index + 1}`}>
                        {t('reports.monthNumber', { number: index + 1 })}
                      </label>
                      <select
                        id={`report-month-${index + 1}`}
                        value={monthValue}
                        onChange={(event) => {
                          const selectedMonth = event.target.value;
                          setMonths((current) => current.map((value, monthIndex) => (
                            monthIndex === index ? selectedMonth : value
                          )));
                        }}
                      >
                        {Array.from({ length: 12 }, (_, monthIndex) => monthIndex + 1).map((monthNumber) => (
                          <option key={monthNumber} value={monthNumber}>{monthName(monthNumber)}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </>
              )}
              <div className="form-group">
                <label htmlFor="report-year">{t('reports.year')}</label>
                <input
                  id="report-year"
                  type="number"
                  min="1900"
                  max="2100"
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  required
                />
              </div>
              <div className="form-group report-file-field">
                <label htmlFor="report-file">{t('reports.file')}</label>
                <input
                  ref={fileInput}
                  id="report-file"
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                  required
                />
              </div>
            </div>
            <p className="report-upload-hint">{t('reports.accepted')}</p>
            {uploadError && <p className="error-msg" role="alert">{uploadError}</p>}
            {uploadSuccess && <p className="success-msg" role="status">{uploadSuccess}</p>}
            <button className="btn btn-primary" type="submit" disabled={uploading}>
              {uploading ? t('reports.uploading') : t('reports.upload')}
            </button>
          </form>
        </section>
      )}

      <section className="card report-list-card">
        <div className="report-list-heading">
          <div>
            <h2>{reportTitle}</h2>
          </div>
          <div className="report-filters">
            <label>
              <span className="sr-only">{t('reports.type')}</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">{t('reports.allTypes')}</option>
                <option value="quarterly">{t('reports.quarterly')}</option>
                <option value="annual">{t('reports.annual')}</option>
              </select>
            </label>
            <label>
              <span className="sr-only">{t('reports.year')}</span>
              <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
                <option value="all">{t('reports.allYears')}</option>
                {years.map((reportYear) => <option key={reportYear} value={reportYear}>{reportYear}</option>)}
              </select>
            </label>
          </div>
        </div>

        {loadError && <p className="error-msg" role="alert">{loadError}</p>}
        {loading ? (
          <p className="report-empty-state">{t('common.loading')}</p>
        ) : filteredReports.length === 0 ? (
          <p className="report-empty-state">{t('reports.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  {canSeeTeam && <th>{t('reports.employee')}</th>}
                  <th>{t('reports.type')}</th>
                  <th>{t('reports.period')}</th>
                  <th>{t('reports.file')}</th>
                  <th>{t('reports.uploaded')}</th>
                  <th aria-label={t('reports.download')} />
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((report) => (
                  <tr key={report.id}>
                    {canSeeTeam && (
                      <td>
                        <strong>{report.first_name} {report.last_name}</strong>
                        {report.position && <small>{report.position}</small>}
                        {report.department_name && <small>{report.department_name}</small>}
                      </td>
                    )}
                    <td>{t(`reports.${report.report_type}`)}</td>
                    <td>{reportPeriod(report)}</td>
                    <td className="report-filename">
                      <span>{report.original_name}</span>
                      <small>{formatSize(report.size_bytes)}</small>
                    </td>
                    <td>{uploadedDate(report.created_at)}</td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadReport(report)}>
                        {t('reports.download')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
