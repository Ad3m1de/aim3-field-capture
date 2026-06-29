// ===== State =====
let currentAdmin = null;
let allUsers = [];

// ===== Auth guard — admin only =====
async function checkAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  const { data: profile, error } = await supabaseClient
    .from('users')
    .select('id, name, role, status')
    .eq('id', session.user.id)
    .single();

  if (error || !profile || profile.status !== 'active' || profile.role !== 'admin') {
    // Not an admin, or account not active — send back to login rather than
    // showing an empty/broken dashboard.
    window.location.href = 'login.html';
    return;
  }

  currentAdmin = profile;
  document.getElementById('admin-name').textContent = profile.name || profile.email || '';
  document.getElementById('auth-guard').hidden = true;
  document.getElementById('dashboard-shell').hidden = false;

  await loadUsers();
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
});

// ===== Tab switching =====
const tabButtons = document.querySelectorAll('.tab-btn');
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;

    tabButtons.forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${target}`);
    });
  });
});

// ===== Confirmation modal helper =====
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmMessage = document.getElementById('confirm-message');
const confirmOkBtn = document.getElementById('confirm-ok-btn');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

function askConfirm(message) {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    confirmOverlay.hidden = false;

    const cleanup = (result) => {
      confirmOverlay.hidden = true;
      confirmOkBtn.removeEventListener('click', onOk);
      confirmCancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    confirmOkBtn.addEventListener('click', onOk);
    confirmCancelBtn.addEventListener('click', onCancel);
  });
}

confirmOverlay.addEventListener('click', (e) => {
  if (e.target === confirmOverlay) {
    confirmOverlay.hidden = true;
  }
});

// ===== Users panel message helper =====
function setUsersMessage(message, type) {
  const el = document.getElementById('users-message');
  el.textContent = message;
  el.className = 'panel-message' + (type ? ' ' + type : '');
}

// ===== Load users =====
async function loadUsers() {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Loading users...</td></tr>';

  const { data, error } = await supabaseClient
    .from('users')
    .select('id, name, email, role, status, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Could not load users.</td></tr>';
    setUsersMessage('Could not load users: ' + error.message, 'error');
    return;
  }

  allUsers = data || [];
  renderUsersTable();
}

// ===== Filters =====
document.getElementById('users-filter-status').addEventListener('change', renderUsersTable);
document.getElementById('users-filter-role').addEventListener('change', renderUsersTable);

function renderUsersTable() {
  const statusFilter = document.getElementById('users-filter-status').value;
  const roleFilter = document.getElementById('users-filter-role').value;

  const filtered = allUsers.filter(u => {
    if (statusFilter && u.status !== statusFilter) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    return true;
  });

  const tbody = document.getElementById('users-table-body');

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No users match these filters.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(user => tbody.appendChild(buildUserRow(user)));
}

function buildUserRow(user) {
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  nameTd.setAttribute('data-label', 'Name');
  nameTd.textContent = user.name || '—';

  const emailTd = document.createElement('td');
  emailTd.setAttribute('data-label', 'Email');
  emailTd.textContent = user.email;

  const roleTd = document.createElement('td');
  roleTd.setAttribute('data-label', 'Role');
  roleTd.appendChild(buildRoleBadge(user.role));

  const statusTd = document.createElement('td');
  statusTd.setAttribute('data-label', 'Status');
  statusTd.appendChild(buildStatusBadge(user.status));

  const joinedTd = document.createElement('td');
  joinedTd.setAttribute('data-label', 'Joined');
  joinedTd.textContent = user.created_at ? new Date(user.created_at).toLocaleDateString() : '—';

  const actionsTd = document.createElement('td');
  actionsTd.setAttribute('data-label', 'Actions');
  actionsTd.appendChild(buildUserActions(user));

  tr.appendChild(nameTd);
  tr.appendChild(emailTd);
  tr.appendChild(roleTd);
  tr.appendChild(statusTd);
  tr.appendChild(joinedTd);
  tr.appendChild(actionsTd);
  return tr;
}

function buildStatusBadge(status) {
  const span = document.createElement('span');
  span.className = `badge status-${status || 'pending'}`;
  span.textContent = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending';
  return span;
}

function buildRoleBadge(role) {
  const span = document.createElement('span');
  span.className = `badge role-${role || 'none'}`;
  span.textContent = role ? (role === 'field_agent' ? 'Field agent' : 'Admin') : 'No role';
  return span;
}

function buildUserActions(user) {
  const wrap = document.createElement('div');
  wrap.className = 'row-actions';

  const isSelf = user.id === currentAdmin.id;

  if (user.status === 'pending') {
    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn-sm approve';
    approveBtn.type = 'button';
    approveBtn.textContent = 'Approve as field agent';
    approveBtn.addEventListener('click', () => approveUser(user, 'field_agent'));
    wrap.appendChild(approveBtn);

    const approveAdminBtn = document.createElement('button');
    approveAdminBtn.className = 'btn-sm approve';
    approveAdminBtn.type = 'button';
    approveAdminBtn.textContent = 'Approve as admin';
    approveAdminBtn.addEventListener('click', () => approveUser(user, 'admin'));
    wrap.appendChild(approveAdminBtn);
  }

  if (user.status === 'active') {
    const deactivateBtn = document.createElement('button');
    deactivateBtn.className = 'btn-sm deactivate';
    deactivateBtn.type = 'button';
    deactivateBtn.textContent = 'Deactivate';
    deactivateBtn.disabled = isSelf;
    deactivateBtn.title = isSelf ? "You can't deactivate your own account" : '';
    deactivateBtn.addEventListener('click', () => deactivateUser(user));
    wrap.appendChild(deactivateBtn);
  }

  if (user.status === 'inactive') {
    const reactivateBtn = document.createElement('button');
    reactivateBtn.className = 'btn-sm activate';
    reactivateBtn.type = 'button';
    reactivateBtn.textContent = 'Reactivate';
    reactivateBtn.addEventListener('click', () => reactivateUser(user));
    wrap.appendChild(reactivateBtn);
  }

  return wrap;
}

// ===== Actions =====
async function approveUser(user, role) {
  const roleLabel = role === 'admin' ? 'admin' : 'field agent';
  const confirmed = await askConfirm(`Approve ${user.name || user.email} as ${roleLabel}?`);
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('users')
    .update({ role, status: 'active' })
    .eq('id', user.id);

  if (error) {
    setUsersMessage('Could not approve user: ' + error.message, 'error');
    return;
  }

  setUsersMessage(`${user.name || user.email} approved as ${roleLabel}.`, 'success');
  await loadUsers();
}

async function deactivateUser(user) {
  const confirmed = await askConfirm(`Deactivate ${user.name || user.email}? They will no longer be able to log in.`);
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('users')
    .update({ status: 'inactive' })
    .eq('id', user.id);

  if (error) {
    setUsersMessage('Could not deactivate user: ' + error.message, 'error');
    return;
  }

  setUsersMessage(`${user.name || user.email} has been deactivated.`, 'success');
  await loadUsers();
}

async function reactivateUser(user) {
  const confirmed = await askConfirm(`Reactivate ${user.name || user.email}?`);
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('users')
    .update({ status: 'active' })
    .eq('id', user.id);

  if (error) {
    setUsersMessage('Could not reactivate user: ' + error.message, 'error');
    return;
  }

  setUsersMessage(`${user.name || user.email} has been reactivated.`, 'success');
  await loadUsers();
}

// ===== Init =====
checkAuth();
