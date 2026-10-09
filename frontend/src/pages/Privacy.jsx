import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n';

export default function Privacy() {
  const { user } = useAuth();
  const { t, getDocument } = useLanguage();
  const home = user ? (user.role === 'coo' ? '/coo' : '/dashboard') : '/login';
  const doc = getDocument('privacy');

  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1>{doc.title}</h1>
        <p className="legal-updated">{doc.lastUpdated}</p>

        <p>{doc.intro}</p>

        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs?.map((text) => (
              <p key={text}>{text}</p>
            ))}
            {section.list && (
              <ul>
                {section.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {section.closing && <p>{section.closing}</p>}
          </section>
        ))}

        <div className="legal-links">
          <Link to="/terms">{t('terms.title')}</Link>
          <Link to={home}>{user ? t('legal.backToDashboard') : t('legal.backToSignIn')}</Link>
        </div>
      </div>
    </div>
  );
}
