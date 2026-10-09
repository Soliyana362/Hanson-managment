import { Component } from 'react';
import { useLanguage } from '../i18n';

// React unmounts the whole tree when a render throws, which looks like a blank
// page with no explanation. This catches it, shows the reason, and lets the user
// get back to a working page without a full reload.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    const { children } = this.props;
    if (!error) return children;
    return <ErrorDetails error={error} onRetry={() => this.setState({ error: null })} />;
  }
}

// Split out so the fallback can read translations through the hook.
function ErrorDetails({ error, onRetry }) {
  const { t } = useLanguage();
  return (
    <div style={{ padding: '32px', maxWidth: '720px', margin: '0 auto' }}>
      <h2 style={{ color: '#C62828', marginBottom: '8px' }}>{t('errorBoundary.title')}</h2>
      <p style={{ color: '#6F8F73', marginBottom: '16px' }}>{t('errorBoundary.body')}</p>
      <pre
        style={{
          background: '#F4F9F5',
          border: '1px solid #E3EDE5',
          borderRadius: '8px',
          padding: '12px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: '0.85rem',
        }}
      >
        {error.message || String(error)}
      </pre>
      <button type="button" className="btn btn-primary" style={{ marginTop: '16px' }} onClick={onRetry}>
        {t('errorBoundary.retry')}
      </button>
    </div>
  );
}
