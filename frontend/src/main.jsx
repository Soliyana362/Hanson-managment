import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { LanguageProvider } from './i18n';
import ErrorBoundary from './components/ErrorBoundary';
import CookieBanner from './components/CookieBanner';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <ErrorBoundary>
          <AuthProvider>
            <App />
            <CookieBanner />
          </AuthProvider>
        </ErrorBoundary>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
);
