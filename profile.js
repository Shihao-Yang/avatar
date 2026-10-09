const $ = id => document.getElementById(id);
export function setupProfile(api) {
  let busy = false;
  const status = message => { $('profile-status').textContent = message; };
  function render(profile) {
    $('profile-account').textContent = `@${profile.login} · GitHub ID ${profile.id}`;
    $('profile-name').value = profile.fullName; $('profile-email').value = profile.email;
    status(profile.status === 'approved' ? 'Shihao has marked this account approved.' : 'Your account is awaiting roster review. You can chat while registration is open.');
  }
  async function open(onlyIfNew = false) {
    try {
      const profile = await (await api('/api/profile')).json();
      if (onlyIfNew && profile.updatedAt) return;
      render(profile); if (!$('profile-dialog').open) $('profile-dialog').showModal();
    } catch (error) { status(error.message); }
  }
  $('open-profile').addEventListener('click', () => open());
  $('close-profile').addEventListener('click', () => $('profile-dialog').close());
  $('profile-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; busy = true; $('save-profile').disabled = true;
    try {
      const result = await (await api('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: $('profile-name').value, email: $('profile-email').value }) })).json();
      render(result); $('profile-dialog').close();
    } catch (error) { status(error.message); }
    finally { busy = false; $('save-profile').disabled = false; }
  });
  return { open };
}
