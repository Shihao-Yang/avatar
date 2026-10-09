import { siteConfig } from './site-config.js';

const transactionKey = 'shihao-avatar-github-transaction';
const $ = id => document.getElementById(id);
let token = null;
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const challenge = async value => encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

export function authHeaders() { return token ? { Authorization: `Bearer ${token}` } : {}; }
export function endpoint(path) { return siteConfig.apiOrigin + path; }
export function requestOptions() { return { credentials: siteConfig.github ? 'omit' : 'same-origin', referrerPolicy: 'no-referrer' }; }
function showStudio(ready) {
  $('auth-gate').hidden = ready;
  $('sidebar').hidden = !ready;
  document.querySelector('main').hidden = !ready;
  if (!ready && $('library-dialog').open) $('library-dialog').close();
  if (!ready && $('student-dialog').open) $('student-dialog').close();
  if (!ready && $('profile-dialog').open) $('profile-dialog').close();
}
export function signedOut(message = 'Sign in to enter your personal studio.') {
  token = null;
  if (!siteConfig.github) { location.replace('/login'); return; }
  showStudio(false); $('auth-status').textContent = message;
}
export async function initializeAuth() {
  if (!siteConfig.github) { showStudio(true); return true; }
  showStudio(false);
  const button = $('github-sign-in');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const config = await (await fetch(endpoint('/api/auth/config'), requestOptions())).json();
      if (!config.enabled) throw new Error('GitHub sign-in setup is not finished yet. Please check back shortly.');
      const verifier = random(), flow = random();
      sessionStorage.setItem(transactionKey, JSON.stringify({ verifier, flow, createdAt: Date.now() }));
      // Only navigate to this configured backend; never accept a redirect supplied by content.
      const url = new URL('/auth/github/start', siteConfig.apiOrigin);
      url.search = new URLSearchParams({ challenge: await challenge(verifier), flow });
      location.assign(url.href);
    } catch (error) { $('auth-status').textContent = error.message; button.disabled = false; }
  });
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('login') || params.has('auth_error')) {
    history.replaceState(null, '', location.pathname + location.search);
    const stored = sessionStorage.getItem(transactionKey);
    sessionStorage.removeItem(transactionKey);
    try {
      if (params.has('auth_error')) throw new Error(params.get('auth_error') === 'not_allowed' ? 'Your GitHub account does not currently have access. Contact Shihao with your GitHub username for help.' : 'Sign-in was cancelled. You can try again.');
      const transaction = JSON.parse(stored || 'null');
      if (!transaction || transaction.flow !== params.get('flow') || Date.now() - transaction.createdAt > 600_000) throw new Error('This sign-in attempt expired. Please start again.');
      const response = await fetch(endpoint('/api/auth/exchange'), { ...requestOptions(), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: params.get('login'), verifier: transaction.verifier }) });
      const data = await response.json();
      if (!response.ok || !/^[A-Za-z0-9_-]{43}$/.test(data.token || '')) throw new Error(data.error || 'Sign-in could not be completed.');
      token = data.token; button.disabled = false; // Memory only. A reload starts a new GitHub sign-in.
      showStudio(true); return true;
    } catch (error) { $('auth-status').textContent = error.message; }
  }
  try {
    const response = await fetch(endpoint('/api/auth/config'), requestOptions());
    if (!response.ok) throw new Error();
    const config = await response.json();
    $('auth-access').textContent = config.accessMode === 'open' ? 'Open to GitHub accounts. Each account has its own profile and conversations.' : 'Access is limited to approved accounts.';
    button.disabled = !config.enabled;
    if (!config.enabled) $('auth-status').textContent = 'GitHub sign-in setup is not finished yet. Please check back shortly.';
  } catch { $('auth-status').textContent = 'The studio is temporarily unreachable. Try again shortly.'; button.disabled = false; }
  return false;
}
