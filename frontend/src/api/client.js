import axios from 'axios';

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// When the frontend and API are on different origins, the csrf_token cookie is
// scoped to the API's domain and is invisible to document.cookie here. The API
// therefore also returns the token in response bodies, and we keep it in memory
// so it can be echoed back in the X-CSRF-Token header.
let csrfToken = '';

export function setCsrfToken(token) {
  csrfToken = typeof token === 'string' ? token : '';
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

const api = axios.create({
  baseURL: `${apiBaseUrl}/api`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const method = String(config.method || 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    const token = csrfToken || readCookie('csrf_token');
    if (token) config.headers['X-CSRF-Token'] = decodeURIComponent(token);
  }
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) delete config.headers['Content-Type'];
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    const authEndpoints = ['/auth/login', '/auth/change-password', '/auth/verify-email', '/auth/resend-verification', '/auth/forgot-password', '/auth/reset-password'];
    const isAuthEndpoint = authEndpoints.some((endpoint) => url.includes(endpoint));
    if (err.response?.status === 401 && !isAuthEndpoint) {
      window.dispatchEvent(new Event('auth:expired'));
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
