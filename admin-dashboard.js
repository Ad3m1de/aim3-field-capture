// ===== State =====
let currentAdmin = null;
let allUsers = [];
let auditPage = 0;
const AUDIT_PAGE_SIZE = 20;

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

    if (target === 'audit') {
      loadAuditLog();
    }
    if (target === 'map') {
      loadMap();
    }
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
    const newRole = user.role === 'admin' ? 'field_agent' : 'admin';
    const newRoleLabel = newRole === 'admin' ? 'Admin' : 'Field agent';

    const changeRoleBtn = document.createElement('button');
    changeRoleBtn.className = 'btn-sm';
    changeRoleBtn.type = 'button';
    changeRoleBtn.textContent = `Make ${newRoleLabel}`;
    changeRoleBtn.disabled = isSelf;
    changeRoleBtn.title = isSelf ? "You can't change your own role" : '';
    changeRoleBtn.addEventListener('click', () => changeUserRole(user, newRole));
    wrap.appendChild(changeRoleBtn);

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

async function changeUserRole(user, newRole) {
  const newRoleLabel = newRole === 'admin' ? 'admin' : 'field agent';
  const confirmed = await askConfirm(
    `Change ${user.name || user.email}'s role to ${newRoleLabel}?` +
    (newRole === 'field_agent' && user.role === 'admin'
      ? ' They will lose access to this dashboard.'
      : '')
  );
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('users')
    .update({ role: newRole })
    .eq('id', user.id);

  if (error) {
    setUsersMessage('Could not change role: ' + error.message, 'error');
    return;
  }

  setUsersMessage(`${user.name || user.email}'s role changed to ${newRoleLabel}.`, 'success');
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

// ===== Audit log panel message helper =====
function setAuditMessage(message, type) {
  const el = document.getElementById('audit-message');
  el.textContent = message;
  el.className = 'panel-message' + (type ? ' ' + type : '');
}

// ===== Audit log filters =====
document.getElementById('audit-filter-entity').addEventListener('change', () => {
  auditPage = 0;
  loadAuditLog();
});
document.getElementById('audit-filter-action').addEventListener('change', () => {
  auditPage = 0;
  loadAuditLog();
});

// ===== Load audit log =====
async function loadAuditLog() {
  const tbody = document.getElementById('audit-table-body');
  tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Loading audit log...</td></tr>';
  setAuditMessage('', null);

  const entityFilter = document.getElementById('audit-filter-entity').value;
  const actionFilter = document.getElementById('audit-filter-action').value;

  // Join against users so we can show the name of whoever made the change,
  // rather than just their raw UUID.
  let query = supabaseClient
    .from('audit_log')
    .select('id, user_id, entity_type, entity_id, action, before_value, after_value, created_at, users:user_id ( name, email )', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(auditPage * AUDIT_PAGE_SIZE, auditPage * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE - 1);

  if (entityFilter) query = query.eq('entity_type', entityFilter);
  if (actionFilter) query = query.eq('action', actionFilter);

  const { data, error, count } = await query;

  if (error) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Could not load audit log.</td></tr>';
    setAuditMessage('Could not load audit log: ' + error.message, 'error');
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No audit entries match these filters.</td></tr>';
    renderAuditPagination(0);
    return;
  }

  tbody.innerHTML = '';
  data.forEach(entry => tbody.appendChild(buildAuditRow(entry)));
  renderAuditPagination(count || 0);
}

function buildAuditRow(entry) {
  const tr = document.createElement('tr');

  const whenTd = document.createElement('td');
  whenTd.setAttribute('data-label', 'When');
  whenTd.textContent = new Date(entry.created_at).toLocaleString();

  const whoTd = document.createElement('td');
  whoTd.setAttribute('data-label', 'Changed by');
  // entry.users comes from the joined select; it's null if the change was
  // made directly via SQL (e.g. during setup/testing) rather than the app,
  // since auth.uid() has nothing to capture outside a real session.
  whoTd.textContent = entry.users ? (entry.users.name || entry.users.email) : 'System / direct DB change';

  const typeTd = document.createElement('td');
  typeTd.setAttribute('data-label', 'Record type');
  typeTd.textContent = entry.entity_type === 'users' ? 'User' : 'Submission';

  const idTd = document.createElement('td');
  idTd.setAttribute('data-label', 'Record ID');
  idTd.textContent = entry.entity_id;
  idTd.style.fontSize = '12px';
  idTd.style.color = 'var(--color-text-muted)';

  const actionTd = document.createElement('td');
  actionTd.setAttribute('data-label', 'Action');
  actionTd.appendChild(buildActionBadge(entry.action));

  const detailsTd = document.createElement('td');
  detailsTd.setAttribute('data-label', 'Details');
  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.className = 'link-btn';
  viewBtn.textContent = 'View changes';
  viewBtn.addEventListener('click', () => openAuditDetail(entry));
  detailsTd.appendChild(viewBtn);

  tr.appendChild(whenTd);
  tr.appendChild(whoTd);
  tr.appendChild(typeTd);
  tr.appendChild(idTd);
  tr.appendChild(actionTd);
  tr.appendChild(detailsTd);
  return tr;
}

function buildActionBadge(action) {
  const span = document.createElement('span');
  const map = { create: 'status-active', update: 'status-pending', delete: 'status-inactive' };
  span.className = `badge ${map[action] || 'status-inactive'}`;
  span.textContent = action.charAt(0).toUpperCase() + action.slice(1);
  return span;
}

// ===== Pagination =====
function renderAuditPagination(totalCount) {
  const pager = document.getElementById('audit-pagination');
  const totalPages = Math.ceil(totalCount / AUDIT_PAGE_SIZE);

  if (totalPages <= 1) {
    pager.innerHTML = '';
    return;
  }

  pager.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.textContent = 'Previous';
  prevBtn.disabled = auditPage === 0;
  prevBtn.addEventListener('click', () => {
    auditPage -= 1;
    loadAuditLog();
  });
  pager.appendChild(prevBtn);

  const pageLabel = document.createElement('button');
  pageLabel.textContent = `Page ${auditPage + 1} of ${totalPages}`;
  pageLabel.className = 'current';
  pageLabel.disabled = true;
  pager.appendChild(pageLabel);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next';
  nextBtn.disabled = auditPage >= totalPages - 1;
  nextBtn.addEventListener('click', () => {
    auditPage += 1;
    loadAuditLog();
  });
  pager.appendChild(nextBtn);
}

// ===== Audit detail modal (before/after diff) =====
const auditDetailOverlay = document.getElementById('audit-detail-overlay');
const auditDetailContent = document.getElementById('audit-detail-content');
document.getElementById('audit-detail-close-btn').addEventListener('click', closeAuditDetail);
auditDetailOverlay.addEventListener('click', (e) => {
  if (e.target === auditDetailOverlay) closeAuditDetail();
});

function closeAuditDetail() {
  auditDetailOverlay.hidden = true;
}

function openAuditDetail(entry) {
  auditDetailContent.innerHTML = '';

  const intro = document.createElement('p');
  intro.style.fontSize = '13px';
  intro.style.color = 'var(--color-text-muted)';
  intro.style.marginTop = '0';
  const who = entry.users ? (entry.users.name || entry.users.email) : 'System / direct DB change';
  intro.textContent = `${who} — ${entry.action} on ${entry.entity_type === 'users' ? 'user' : 'submission'} record — ${new Date(entry.created_at).toLocaleString()}`;
  auditDetailContent.appendChild(intro);

  const before = entry.before_value || {};
  const after = entry.after_value || {};
  const allFields = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();

  // Fields that aren't useful to show in a diff (internal/system noise).
  const hiddenFields = ['updated_at'];
  const visibleFields = allFields.filter(f => !hiddenFields.includes(f));

  if (visibleFields.length === 0) {
    const none = document.createElement('p');
    none.textContent = 'No field-level details available for this entry.';
    auditDetailContent.appendChild(none);
    return;
  }

  const header = document.createElement('div');
  header.className = 'diff-header';
  header.innerHTML = '<span>Field</span><span>Before</span><span>After</span>';
  auditDetailContent.appendChild(header);

  visibleFields.forEach(field => {
    const beforeVal = before[field];
    const afterVal = after[field];
    const changed = JSON.stringify(beforeVal) !== JSON.stringify(afterVal);

    // Only show fields that actually changed, unless this was a create/delete
    // (in which case there's only one side anyway).
    if (entry.action === 'update' && !changed) return;

    const row = document.createElement('div');
    row.className = 'diff-row';

    const fieldEl = document.createElement('span');
    fieldEl.className = 'diff-field';
    fieldEl.textContent = field;

    const beforeEl = document.createElement('span');
    beforeEl.className = 'diff-before';
    beforeEl.textContent = formatDiffValue(beforeVal);

    const afterEl = document.createElement('span');
    afterEl.className = 'diff-after';
    afterEl.textContent = formatDiffValue(afterVal);

    row.appendChild(fieldEl);
    row.appendChild(beforeEl);
    row.appendChild(afterEl);
    auditDetailContent.appendChild(row);
  });

  auditDetailOverlay.hidden = false;
}

function formatDiffValue(val) {
  if (val === undefined) return '—';
  if (val === null) return 'null';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// ===== Map panel =====
let leafletMap = null;
let markersLayer = null;
let mapInitialized = false;

function setMapMessage(message, type) {
  const el = document.getElementById('map-message');
  el.textContent = message;
  el.className = 'panel-message' + (type ? ' ' + type : '');
}

document.getElementById('map-refresh-btn').addEventListener('click', loadMap);
document.getElementById('map-clear-btn').addEventListener('click', () => {
  document.getElementById('map-filter-from').value = '';
  document.getElementById('map-filter-to').value = '';
  loadMap();
});

function initLeafletMap() {
  if (mapInitialized) return;
  leafletMap = L.map('map-container').setView([52.9548, -1.1581], 6); // roughly centred on the UK
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(leafletMap);
  markersLayer = L.layerGroup().addTo(leafletMap);
  mapInitialized = true;
}

async function loadMap() {
  initLeafletMap();

  // Leaflet needs to recalculate its size if the container was hidden
  // (display:none on inactive tabs) when the map was first created.
  // Called at multiple delays since tab-switch timing can vary.
  leafletMap.invalidateSize();
  setTimeout(() => leafletMap.invalidateSize(), 100);
  setTimeout(() => leafletMap.invalidateSize(), 400);

  setMapMessage('', null);
  markersLayer.clearLayers();
  document.getElementById('map-count-note').textContent = 'Loading locations...';

  const fromDate = document.getElementById('map-filter-from').value;
  const toDate = document.getElementById('map-filter-to').value;

  let query = supabaseClient
    .from('geolocations')
    .select(`
      id, latitude, longitude, accuracy_meters, captured_at,
      submissions:submission_id (
        submission_ref, business_name, contact_name, created_at,
        users:user_id ( name, email )
      )
    `);

  if (fromDate) query = query.gte('captured_at', `${fromDate}T00:00:00`);
  if (toDate) query = query.lte('captured_at', `${toDate}T23:59:59`);

  const { data, error } = await query;

  if (error) {
    setMapMessage('Could not load locations: ' + error.message, 'error');
    document.getElementById('map-count-note').textContent = '';
    return;
  }

  if (!data || data.length === 0) {
    document.getElementById('map-count-note').textContent = 'No captured locations match this filter.';
    return;
  }

  const bounds = [];

  data.forEach(loc => {
    const marker = L.marker([loc.latitude, loc.longitude]);
    const sub = loc.submissions;
    const agentName = sub && sub.users ? (sub.users.name || sub.users.email) : 'Unknown';

    const popupHtml = `
      <div class="map-popup-title">${escapeHtml(sub ? sub.business_name : 'Unknown business')}</div>
      <div class="map-popup-row"><strong>Contact:</strong> ${escapeHtml(sub ? sub.contact_name : '—')}</div>
      <div class="map-popup-row"><strong>Field agent:</strong> ${escapeHtml(agentName)}</div>
      <div class="map-popup-row"><strong>Ref:</strong> ${escapeHtml(sub ? sub.submission_ref : '—')}</div>
      <div class="map-popup-row"><strong>Captured:</strong> ${new Date(loc.captured_at).toLocaleString()}</div>
      <div class="map-popup-row"><strong>Accuracy:</strong> ±${Math.round(loc.accuracy_meters || 0)}m</div>
    `;
    marker.bindPopup(popupHtml);
    markersLayer.addLayer(marker);
    bounds.push([loc.latitude, loc.longitude]);
  });

  if (bounds.length > 0) {
    leafletMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }

  document.getElementById('map-count-note').textContent =
    `Showing ${data.length} location${data.length === 1 ? '' : 's'}.`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Init =====
checkAuth();
