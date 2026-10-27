import axios from 'axios';

// Keep the CSRF token in memory so write requests can echo it in the
// X-CSRF-Token header without depending on browser cookie access behavior.
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
  // Keep API calls on the website's origin. The hosting rewrites proxy /api
  // to the backend, so browsers that block cross-site cookies (common on phones)
  // still store and send the HttpOnly session cookie as a first-party cookie.
  baseURL: '/api',
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
    const authEndpoints = ['/auth/login', '/auth/me', '/auth/change-password', '/auth/verify-email', '/auth/resend-verification', '/auth/forgot-password', '/auth/reset-password'];
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
