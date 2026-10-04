import { marked } from './vendor/marked.js';
import DOMPurify from './vendor/purify.js';
import katex from './vendor/katex.js';
import { initializeAuth, signedOut, endpoint, authHeaders, requestOptions } from './auth.js';
import { setupStudentAccess } from './admin.js';

// Tokenize math before Markdown consumes TeX delimiters. HTML is sanitized afterward.
marked.use({ extensions: [
  { name: 'displayMath', level: 'block', start: src => { const i = src.search(/\$\$|\\\[/); return i < 0 ? undefined : i; }, tokenizer(src) { const m = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:\n|$)/.exec(src); if (m) return { type: 'displayMath', raw: m[0], text: m[1] ?? m[2] }; }, renderer: t => katex.renderToString(t.text, { displayMode: true, throwOnError: false, trust: false, maxExpand: 1000 }) },
  { name: 'inlineMath', level: 'inline', start: src => { const i = src.search(/\\\(|\$/); return i < 0 ? undefined : i; }, tokenizer(src) { const m = /^(?:\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$)/.exec(src); if (m) return { type: 'inlineMath', raw: m[0], text: m[1] ?? m[2] }; }, renderer: t => katex.renderToString(t.text, { throwOnError: false, trust: false, maxExpand: 1000 }) }
] });
const $ = id => document.getElementById(id);
let state, current = null, mode = 'explain', busy = false, activeId = null, pollTimer, loadingGeneration = 0;
const prompt = $('prompt');
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
async function api(path, options = {}) {
  const response = await fetch(endpoint(path), { ...requestOptions(), ...options, headers: { ...authHeaders(), ...(options.method === 'POST' ? { 'X-Avatar-Token': state?.csrf } : {}), ...options.headers } });
  if (response.status === 401) { clearInterval(pollTimer); signedOut('Your session ended. Please sign in again.'); throw new Error('Your session ended. Please sign in again.'); }
  if (!response.ok) { let data; try { data = await response.json(); } catch {} throw new Error(data?.error || `Request failed (${response.status}).`); }
  return response;
}
function markdown(text, target) {
  target.innerHTML = DOMPurify.sanitize(marked.parse(text), { FORBID_TAGS: ['img', 'style', 'form', 'input', 'button', 'iframe', 'video', 'audio', 'script', 'object'], FORBID_ATTR: ['id', 'name'] });
  target.querySelectorAll('a').forEach(a => {
    const url = new URL(a.getAttribute('href') || '', location.origin);
    if (url.origin === location.origin && /^\/materials\/[a-z0-9-]+$/.test(url.pathname)) {
      a.addEventListener('click', e => { e.preventDefault(); showNote(url.pathname.split('/').pop()).catch(e => notice(e.message)); });
    } else if (['http:', 'https:'].includes(url.protocol)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    else a.removeAttribute('href');
  });
}
function setMode(value) { mode = value; document.querySelectorAll('.mode').forEach(b => { b.classList.toggle('active', b.dataset.mode === value); b.setAttribute('aria-pressed', String(b.dataset.mode === value)); }); }
function updateControls() {
  $('send').hidden = busy; $('send').disabled = !state?.auth.ready || !prompt.value.trim() || state?.usage?.remaining === 0;
  $('stop').hidden = !busy; $('new-chat').disabled = busy;
  prompt.disabled = busy;
  const admin = state?.access?.role === 'admin';
  $('connection').disabled = !admin;
  $('connection').title = admin ? 'Check connection' : 'Tutor status';
  $('connection-label').textContent = state?.auth.ready ? (admin ? 'Codex connected' : 'Tutor available') : 'Temporarily unavailable';
  $('connection').classList.toggle('offline', !state?.auth.ready);
  if (state?.model) document.querySelector('.model-label').textContent = `${state.model} · Codex CLI`;
  const usage = state?.usage;
  $('usage-limit').hidden = !usage || usage.limit === null;
  if (usage && usage.limit !== null) $('usage-limit').textContent = `${usage.remaining} of ${usage.limit} questions left today · Resets ${new Date(usage.resetsAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}
function renderHistory() {
  const history = $('history'); history.replaceChildren();
  if (!state.conversations.length) { const p = document.createElement('p'); p.className = 'empty-history'; p.textContent = 'Good questions start here.'; history.append(p); }
  for (const c of state.conversations) {
    const b = document.createElement('button'); b.className = 'history-item'; b.classList.toggle('active', current?.id === c.id); b.textContent = c.title; b.title = c.title;
    b.addEventListener('click', () => { if (busy) { notice('Wait for the current answer or stop it before changing conversations.'); return; } openConversation(c.id).catch(e => notice(e.message)); }); history.append(b);
  }
}
function bubble(message) {
  const node = document.createElement('article'); node.className = `message ${message.role}`;
  if (message.role === 'user') node.textContent = message.content;
  else {
    const label = document.createElement('div'); label.className = 'message-label'; label.innerHTML = '<span class="answer-mark" aria-hidden="true">✳</span> Shihao’s AI companion';
    const content = document.createElement('div'); content.className = 'message-content'; markdown(message.content, content);
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const copy = document.createElement('button'); copy.className = 'copy-button'; copy.textContent = 'Copy answer';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(message.content); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy answer'; }, 1800); } catch { notice('Copy is unavailable in this browser. You can select the answer text.'); } });
    actions.append(copy); node.append(label, content, actions);
  }
  return node;
}
function renderConversation(partial = '') {
  const messages = $('messages'); messages.replaceChildren();
  $('welcome').hidden = Boolean(current?.messages.length);
  if (current) for (const m of current.messages) messages.append(bubble(m));
  if (partial) messages.append(bubble({ role: 'assistant', content: partial }));
  if (busy) { const el = document.createElement('div'); el.className = 'thinking'; el.innerHTML = '<i></i><i></i><i></i><span>Thinking it through…</span>'; el.setAttribute('role', 'status'); messages.append(el); }
  if (current?.error) { const el = document.createElement('p'); el.className = 'error-message'; el.textContent = current.error; messages.append(el); }
  if (current?.messages.length) requestAnimationFrame(() => $('scroll-region').scrollTo({ top: $('scroll-region').scrollHeight, behavior: 'instant' }));
}
async function refresh() {
  state = await (await api('/api/state')).json(); activeId = state.activeId;
  $('note-count').textContent = `${state.materials.length} selected notes`;
  $('sign-out').hidden = !state.access?.enabled;
  $('account-detail').textContent = state.access?.username ? `Signed in as ${state.access.username}` : 'Saved on this server';
  const admin = state.access?.role === 'admin';
  $('open-students').hidden = !admin;
  $('workspace-label').textContent = admin ? 'Your workspace' : 'My conversations';
  $('photo-button').disabled = !admin;
  $('photo-button').title = admin ? 'Add your photo' : 'Shihao Yang';
  $('photo-button').setAttribute('aria-label', admin ? 'Add your photo' : 'Shihao Yang');
  renderHistory(); updateControls();
}
async function openConversation(id) {
  const generation = ++loadingGeneration;
  const c = await (await api(`/api/conversations/${id}`)).json(); if (generation !== loadingGeneration) return;
  current = c; sessionStorage.setItem('avatar-conversation', id); $('sidebar').classList.remove('open'); renderHistory(); renderConversation();
}
function newChat() { if (busy) return; ++loadingGeneration; current = null; sessionStorage.removeItem('avatar-conversation'); notice(); renderHistory(); renderConversation(); prompt.value = ''; prompt.disabled = false; prompt.focus(); updateControls(); $('sidebar').classList.remove('open'); }
async function submit(event) {
  event?.preventDefault(); const text = prompt.value.trim(); if (!text || busy || !state?.auth.ready || state?.usage?.remaining === 0) return;
  notice(); busy = true; updateControls(); ++loadingGeneration;
  try {
    if (!current) { current = await (await api('/api/conversations', { method: 'POST' })).json(); sessionStorage.setItem('avatar-conversation', current.id); }
    activeId = current.id;
    const response = await api(`/api/conversations/${current.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text, mode }) });
    prompt.value = ''; prompt.style.height = ''; const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', doneSeen = false;
    while (true) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end; while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line) continue; const event = JSON.parse(line);
        if (event.type === 'started') { current = event.conversation; renderConversation(); }
        if (event.type === 'answer') renderConversation(event.content);
        if (event.type === 'done') { doneSeen = true; current = event.conversation; busy = false; renderConversation(); }
      }
      if (chunk.done) break;
    }
    if (!doneSeen) throw new Error('The connection ended. Your saved conversation will reload.');
  } catch (e) { notice(e.message); if (current) try { current = await (await api(`/api/conversations/${current.id}`)).json(); } catch {} }
  finally { busy = false; activeId = null; await refresh().catch(() => {}); renderConversation(); updateControls(); prompt.focus(); }
}
async function showLibrary() {
  $('library-title').textContent = 'Notes to think with'; const content = $('library-content'); content.replaceChildren();
  for (const m of state.materials) { const button = document.createElement('button'); button.className = 'note-card'; const title = document.createElement('strong'); title.textContent = m.title; const desc = document.createElement('span'); desc.textContent = m.source; button.append(title, desc); button.addEventListener('click', () => showNote(m.id).catch(e => notice(e.message))); content.append(button); }
  if (!$('library-dialog').open) $('library-dialog').showModal();
}
async function showNote(id) {
  const note = await (await api(`/api/materials/${id}`)).json(); $('library-title').textContent = note.title; const content = $('library-content'); content.replaceChildren();
  const back = document.createElement('button'); back.className = 'back-notes'; back.textContent = '← All reference notes'; back.addEventListener('click', showLibrary);
  const text = document.createElement('div'); text.className = 'message-content'; markdown(note.text, text); content.append(back, text); if (!$('library-dialog').open) $('library-dialog').showModal();
}
async function loadPhoto() { try { const r = await api('/api/photo'); const photo = $('portrait-image'); const old = photo.src; photo.src = URL.createObjectURL(await r.blob()); photo.hidden = false; if (old.startsWith('blob:')) URL.revokeObjectURL(old); } catch {} }
$('composer').addEventListener('submit', submit);
setupStudentAccess(api);
prompt.addEventListener('input', () => { prompt.style.height = 'auto'; prompt.style.height = `${Math.min(prompt.scrollHeight, 140)}px`; updateControls(); });
prompt.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('.suggestion').forEach(b => b.addEventListener('click', () => { setMode(b.dataset.mode); prompt.value = b.dataset.prompt; updateControls(); prompt.focus(); }));
$('new-chat').addEventListener('click', newChat);
$('sign-out').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); sessionStorage.removeItem('avatar-conversation'); clearInterval(pollTimer); current = null; state = null; $('history').replaceChildren(); $('messages').replaceChildren(); $('library-content').replaceChildren(); const photo = $('portrait-image'); if (photo.src.startsWith('blob:')) URL.revokeObjectURL(photo.src); photo.removeAttribute('src'); photo.hidden = true; signedOut(); } catch (e) { notice(e.message); } });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.addEventListener('keydown', e => { if (state && (e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); newChat(); } });
$('stop').addEventListener('click', async () => { if (!activeId) return; try { await api(`/api/conversations/${activeId}/cancel`, { method: 'POST' }); } catch (e) { notice(e.message); } });
$('connection').addEventListener('click', async () => { try { state.auth = await (await api('/api/reconnect', { method: 'POST' })).json(); notice(state.auth.ready ? '' : state.auth.message); updateControls(); } catch (e) { notice(e.message); } });
$('menu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
$('open-library').addEventListener('click', showLibrary);
$('close-library').addEventListener('click', () => $('library-dialog').close());
$('photo-button').addEventListener('click', () => $('photo-input').click());
$('photo-input').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; try { if (file.size > 2000000) throw new Error('Choose a photo smaller than 2 MB.'); await api('/api/photo', { method: 'POST', headers: { 'Content-Type': file.type }, body: file }); await loadPhoto(); notice('Your photo is saved on this server.'); } catch (e) { notice(e.message); } finally { event.target.value = ''; } });
if (await initializeAuth()) try {
  await refresh(); await loadPhoto();
  if (!state.auth.ready) notice(state.auth.message);
  const saved = sessionStorage.getItem('avatar-conversation');
  if (activeId || saved && state.conversations.some(c => c.id === saved)) await openConversation(activeId || saved);
  if (activeId) { busy = true; updateControls(); renderConversation(); pollTimer = setInterval(async () => { try { await refresh(); if (current) await openConversation(current.id); if (!state.activeId) { clearInterval(pollTimer); busy = false; updateControls(); renderConversation(); } } catch { clearInterval(pollTimer); notice('Lost connection to the server. Reload when it is running again.'); } }, 1500); }
  const noteId = new URLSearchParams(location.search).get('note');
  if (/^[a-z0-9-]+$/.test(noteId || '')) await showNote(noteId);
} catch (e) { notice(`Could not connect to your studio. ${e.message}`); }
