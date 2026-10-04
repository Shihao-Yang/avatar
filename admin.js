const $ = id => document.getElementById(id);

export function setupStudentAccess(api) {
  let ticket = null, busy = false, latest;
  const status = message => { $('student-status').textContent = message; };
  const post = async (path, data) => (await api('/api/admin/students/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
  function controls() { for (const element of $('student-dialog').querySelectorAll('button:not(#close-students), input, textarea')) element.disabled = busy; $('approve-students').disabled = busy || !ticket; }
  async function action(work) { if (busy) return; busy = true; controls(); try { await work(); } catch (error) { status(error.message); } finally { busy = false; controls(); } }
  function render(data) {
    latest = { ...latest, ...data }; $('daily-limit').value = data.dailyLimit;
    $('student-count').textContent = `${data.students.length} approved ${data.students.length === 1 ? 'account' : 'accounts'}`;
    const list = $('student-list'); list.replaceChildren();
    if (!data.students.length) { const p = document.createElement('p'); p.textContent = 'No students have been approved yet.'; p.className = 'student-help'; list.append(p); }
    for (const student of data.students) {
      const row = document.createElement('div'); row.className = 'student-row';
      const label = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = student.login; detail.textContent = `GitHub ID ${student.id}`; label.append(name, detail);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'student-remove'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove ' + student.login);
      remove.addEventListener('click', () => action(async () => { const result = await post('remove', { id: student.id }); render(result); status(`${student.login} no longer has access. Existing sessions were revoked.`); }));
      row.append(label, remove); list.append(row);
    }
  }
  $('open-students').addEventListener('click', () => action(async () => {
    ticket = null; $('student-preview').replaceChildren(); $('approve-students').hidden = true; status('Loading student access…');
    if (!$('student-dialog').open) $('student-dialog').showModal();
    render(await (await api('/api/admin/students')).json());
    status(latest.githubEnabled ? 'Only approved accounts can enter. Each account has its own conversation history.' : 'You can prepare the list now. Student sign-in will become available after GitHub app setup is completed.');
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
    render(await post('settings', { dailyLimit: Number($('daily-limit').value) })); status('Daily question limit saved. It applies to every student.');
  }); });
}
