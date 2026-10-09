const $ = id => document.getElementById(id);
export function accountsCsv(students) {
  const cell = value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  const rows = [['GitHub username', 'GitHub ID', 'Review status', 'Self-reported full name', 'Self-reported GT email', 'Registered at', 'First sign-in', 'Last sign-in', 'Reviewed at', 'Profile updated at'], ...students.map(s => [s.login, s.id, s.status, s.profile?.fullName, s.profile?.email, s.addedAt, s.firstLoginAt, s.lastLoginAt, s.reviewedAt, s.profileUpdatedAt])];
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function setupStudentAccess(api) {
  let ticket = null, busy = false, latest;
  const status = message => { $('student-status').textContent = message; };
  const post = async (path, data) => (await api('/api/admin/students/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
  function controls() { for (const element of $('student-dialog').querySelectorAll('button:not(#close-students), input, textarea, select')) element.disabled = busy; $('approve-students').disabled = busy || !ticket; $('export-students').disabled = busy || !latest?.students.length; }
  async function action(work) { if (busy) return; busy = true; controls(); try { await work(); } catch (error) { status(error.message); } finally { busy = false; controls(); } }
  function render(data) {
    latest = { ...latest, ...data }; $('daily-limit').value = data.dailyLimit; $('access-mode').value = data.accessMode;
    $('access-summary').textContent = data.accessMode === 'open' ? 'Open registration: anyone with a GitHub account can sign in and chat. New accounts appear here for your roster review. Blocked accounts cannot return.' : 'Approved accounts only: new accounts need your approval before they can enter.';
    $('student-count').textContent = `${data.students.length} accounts · ${data.students.filter(s => s.status === 'unreviewed').length} awaiting review`;
    const list = $('student-list'); list.replaceChildren();
    if (!data.students.length) { const p = document.createElement('p'); p.textContent = 'No accounts yet. They will appear after their first GitHub sign-in, or you can add usernames below.'; p.className = 'student-help'; list.append(p); }
    const order = { unreviewed: 0, approved: 1, blocked: 2 };
    for (const student of [...data.students].sort((a, b) => order[a.status] - order[b.status] || a.login.localeCompare(b.login))) {
      const row = document.createElement('div'); row.className = 'student-row';
      const label = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = '@' + student.login; detail.textContent = `GitHub ID ${student.id} · ${student.status === 'unreviewed' ? 'Awaiting roster review' : student.status === 'approved' ? 'Approved' : 'Blocked'}`; label.append(name, detail);
      const profile = document.createElement('small'); profile.textContent = [student.profile?.fullName, student.profile?.email].filter(Boolean).join(' · ') || 'No self-reported details yet'; label.append(profile);
      const last = document.createElement('small'); last.textContent = student.lastLoginAt ? 'Last sign-in: ' + new Date(student.lastLoginAt).toLocaleString() : 'Has not signed in yet'; label.append(last);
      const buttons = document.createElement('div'); buttons.className = 'student-actions';
      if (student.status !== 'approved') {
        const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'student-remove'; approve.textContent = student.status === 'blocked' ? 'Unblock and approve' : 'Mark approved'; approve.setAttribute('aria-label', approve.textContent + ' ' + student.login);
        approve.addEventListener('click', () => action(async () => { render(await post('review', { id: student.id, status: 'approved' })); status(`${student.login} is approved.`); })); buttons.append(approve);
      }
      if (student.status !== 'blocked') {
        const block = document.createElement('button'); block.type = 'button'; block.className = 'student-remove'; block.textContent = 'Block'; block.setAttribute('aria-label', 'Block ' + student.login);
        block.addEventListener('click', () => action(async () => { render(await post('review', { id: student.id, status: 'blocked' })); status(`${student.login} is blocked. Existing sessions were revoked.`); })); buttons.append(block);
      }
      row.append(label, buttons); list.append(row);
    }
  }
  $('open-students').addEventListener('click', () => action(async () => {
    ticket = null; $('student-preview').replaceChildren(); $('approve-students').hidden = true; status('Loading student access…');
    if (!$('student-dialog').open) $('student-dialog').showModal();
    render(await (await api('/api/admin/students')).json());
    status(latest.githubEnabled ? 'Each account has its own conversation history. Match self-reported details against your official roster before marking an account approved.' : 'GitHub sign-in setup is not complete yet.');
  }));
  $('close-students').addEventListener('click', () => $('student-dialog').close());
  $('student-usernames').addEventListener('input', () => { ticket = null; $('approve-students').hidden = true; $('student-preview').replaceChildren(); });
  $('student-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
    ticket = null; $('approve-students').hidden = true; $('student-preview').replaceChildren(); status('Checking GitHub usernames…');
    const result = await post('preview', { usernames: $('student-usernames').value }); ticket = result.ticket;
    const preview = $('student-preview');
    for (const account of result.accounts) {
      const row = document.createElement('p'), link = document.createElement('a');
      link.textContent = account.login; link.href = 'https://github.com/' + account.login; link.target = '_blank'; link.rel = 'noopener noreferrer';
      row.append(link, document.createTextNode(` · GitHub ID ${account.id}`)); preview.append(row);
    }
    for (const error of result.errors) { const row = document.createElement('p'); row.className = 'student-error'; row.textContent = `${error.login}: ${error.message}`; preview.append(row); }
    $('approve-students').textContent = `Approve ${result.accounts.length} ${result.accounts.length === 1 ? 'account' : 'accounts'}`;
    $('approve-students').hidden = !ticket;
    status(ticket ? 'Check these accounts against your class roster, then approve them below. Accounts with errors will not be added.' : 'No accounts are ready to approve. Check the usernames and try again.');
  }); });
  $('approve-students').addEventListener('click', () => action(async () => {
    const selected = ticket; ticket = null; $('approve-students').hidden = true;
    render(await post('approve', { ticket: selected })); $('student-usernames').value = ''; $('student-preview').replaceChildren();
    status(latest.githubEnabled ? 'Approved accounts saved. Students can now sign in with GitHub.' : 'Approved accounts saved. Students can sign in once GitHub app setup is complete.');
  }));
  $('student-limits').addEventListener('submit', event => { event.preventDefault(); action(async () => {
    render(await post('settings', { dailyLimit: Number($('daily-limit').value), accessMode: $('access-mode').value })); status('Access settings saved. The daily limit applies to every student.');
  }); });
  $('export-students').addEventListener('click', () => {
    if (!latest?.students.length) return;
    const url = URL.createObjectURL(new Blob([accountsCsv(latest.students)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'studio-accounts-' + new Date().toISOString().slice(0, 10) + '.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Account CSV downloaded. It contains private, self-reported profile details for your roster check.');
  });
}
