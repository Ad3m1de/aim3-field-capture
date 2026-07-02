// ===== State =====
let currentAdmin = null;
let allUsers = [];
let auditPage = 0;
const AUDIT_PAGE_SIZE = 20;
let submissionsPage = 0;
const SUBMISSIONS_PAGE_SIZE = 20;
let lastSubmissionsFilters = {};

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
    if (target === 'submissions') {
      loadFieldUserOptions();
      loadSubmissions();
    }
    if (target === 'brands') {
      loadBrandsPanel();
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
  // MarkerClusterGroup groups overlapping markers into a numbered badge
  // rather than stacking them invisibly. Clicking zooms in; at max zoom
  // it spiderfies markers outward so each one is individually clickable.
  markersLayer = L.markerClusterGroup({
    maxClusterRadius: 40,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false
  });
  leafletMap.addLayer(markersLayer);
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

// ===== Submissions panel message helper =====
function setSubmissionsMessage(message, type) {
  const el = document.getElementById('submissions-message');
  el.textContent = message;
  el.className = 'panel-message' + (type ? ' ' + type : '');
}

// ===== Field user filter dropdown =====
let fieldUserOptionsLoaded = false;

async function loadFieldUserOptions() {
  if (fieldUserOptionsLoaded) return;

  const { data, error } = await supabaseClient
    .from('users')
    .select('id, name, email')
    .order('name');

  if (error || !data) return;

  const select = document.getElementById('sub-filter-agent');
  data.forEach(user => {
    const opt = document.createElement('option');
    opt.value = user.id;
    opt.textContent = user.name || user.email;
    select.appendChild(opt);
  });
  fieldUserOptionsLoaded = true;
}

// ===== Filter wiring =====
document.getElementById('sub-filter-apply-btn').addEventListener('click', () => {
  submissionsPage = 0;
  loadSubmissions();
});

document.getElementById('sub-filter-clear-btn').addEventListener('click', () => {
  document.getElementById('sub-filter-business').value = '';
  document.getElementById('sub-filter-location').value = '';
  document.getElementById('sub-filter-agent').value = '';
  document.getElementById('sub-filter-brand').value = '';
  document.getElementById('sub-filter-region').value = '';
  document.getElementById('sub-filter-from').value = '';
  document.getElementById('sub-filter-to').value = '';
  document.getElementById('sub-filter-cust-min').value = '';
  document.getElementById('sub-filter-cust-max').value = '';
  submissionsPage = 0;
  loadSubmissions();
});

function readSubmissionsFilters() {
  return {
    business: document.getElementById('sub-filter-business').value.trim(),
    location: document.getElementById('sub-filter-location').value.trim(),
    agentId: document.getElementById('sub-filter-agent').value,
    brand: document.getElementById('sub-filter-brand').value.trim(),
    region: document.getElementById('sub-filter-region').value,
    fromDate: document.getElementById('sub-filter-from').value,
    toDate: document.getElementById('sub-filter-to').value,
    custMin: document.getElementById('sub-filter-cust-min').value,
    custMax: document.getElementById('sub-filter-cust-max').value
  };
}

// Builds a Supabase query with every active filter applied. Shared between
// the paginated table load and the export-all-matching-rows function, so
// the two never drift out of sync with each other.
async function buildSubmissionsQuery(filters, { forExport } = {}) {
  let query = supabaseClient
    .from('submissions')
    .select(`
      id, submission_ref, contact_name, business_name, business_address,
      phone_number, years_in_business, customers_per_day, respondent_age,
      mechanic_count, land_ownership, region, previous_training, notes, status,
      submitted_at, created_at,
      users:user_id ( id, name, email ),
      photos ( id, file_path, file_size_bytes, mime_type ),
      geolocations ( latitude, longitude, accuracy_meters, captured_at ),
      submission_brands ( rank, brands ( name ) )
    `, forExport ? {} : { count: 'exact' })
    .order('created_at', { ascending: false });

  if (filters.business) query = query.ilike('business_name', `%${filters.business}%`);
  if (filters.location) query = query.ilike('business_address', `%${filters.location}%`);
  if (filters.agentId) query = query.eq('user_id', filters.agentId);
  if (filters.region) query = query.eq('region', filters.region);
  if (filters.fromDate) query = query.gte('created_at', `${filters.fromDate}T00:00:00`);
  if (filters.toDate) query = query.lte('created_at', `${filters.toDate}T23:59:59`);
  if (filters.custMin !== '') query = query.gte('customers_per_day', Number(filters.custMin));
  if (filters.custMax !== '') query = query.lte('customers_per_day', Number(filters.custMax));

  // Brand filter — looks up submissions that have a matching brand name in
  // submission_brands, using Supabase's nested filter syntax.
  if (filters.brand) {
    const { data: matchingBrands } = await supabaseClient
      .from('brands')
      .select('id')
      .ilike('name', `%${filters.brand}%`);

    if (matchingBrands && matchingBrands.length > 0) {
      const brandIds = matchingBrands.map(b => b.id);
      const { data: matchingSubs } = await supabaseClient
        .from('submission_brands')
        .select('submission_id')
        .in('brand_id', brandIds);

      if (matchingSubs && matchingSubs.length > 0) {
        const subIds = [...new Set(matchingSubs.map(s => s.submission_id))];
        query = query.in('id', subIds);
      } else {
        // No submissions match this brand — force empty result.
        query = query.in('id', [-1]);
      }
    } else {
      // Brand name not found — force empty result.
      query = query.in('id', [-1]);
    }
  }

  if (!forExport) {
    query = query.range(submissionsPage * SUBMISSIONS_PAGE_SIZE, submissionsPage * SUBMISSIONS_PAGE_SIZE + SUBMISSIONS_PAGE_SIZE - 1);
  }

  return query;
}

// ===== Load submissions (paginated table) =====
async function loadSubmissions() {
  const tbody = document.getElementById('submissions-table-body');
  tbody.innerHTML = '<tr><td colspan="9" class="table-loading">Loading submissions...</td></tr>';
  setSubmissionsMessage('', null);

  const filters = readSubmissionsFilters();
  lastSubmissionsFilters = filters;

  const { data, error, count } = await buildSubmissionsQuery(filters);

  if (error) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">Could not load submissions.</td></tr>';
    setSubmissionsMessage('Could not load submissions: ' + error.message, 'error');
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No submissions match these filters.</td></tr>';
    renderSubmissionsPagination(0);
    return;
  }

  tbody.innerHTML = '';
  data.forEach(sub => tbody.appendChild(buildSubmissionRow(sub)));
  renderSubmissionsPagination(count || 0);
}

function buildSubmissionRow(sub) {
  const tr = document.createElement('tr');

  const dateTd = document.createElement('td');
  dateTd.setAttribute('data-label', 'Date');
  dateTd.textContent = new Date(sub.created_at).toLocaleDateString();

  const businessTd = document.createElement('td');
  businessTd.setAttribute('data-label', 'Business');
  businessTd.textContent = sub.business_name;

  const contactTd = document.createElement('td');
  contactTd.setAttribute('data-label', 'Contact');
  contactTd.textContent = sub.contact_name;

  const agentTd = document.createElement('td');
  agentTd.setAttribute('data-label', 'Field user');
  agentTd.textContent = sub.users ? (sub.users.name || sub.users.email) : 'Unknown';

  const phoneTd = document.createElement('td');
  phoneTd.setAttribute('data-label', 'Phone');
  phoneTd.textContent = sub.phone_number;

  const custTd = document.createElement('td');
  custTd.setAttribute('data-label', 'Customers/day');
  custTd.textContent = sub.customers_per_day ?? '—';

  const regionTd = document.createElement('td');
  regionTd.setAttribute('data-label', 'Region');
  regionTd.textContent = sub.region;

  const statusTd = document.createElement('td');
  statusTd.setAttribute('data-label', 'Status');
  const statusBadge = document.createElement('span');
  statusBadge.className = `badge status-${sub.status === 'submitted' ? 'active' : 'pending'}`;
  statusBadge.textContent = sub.status.charAt(0).toUpperCase() + sub.status.slice(1);
  statusTd.appendChild(statusBadge);

  const detailsTd = document.createElement('td');
  detailsTd.setAttribute('data-label', 'Details');

  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.className = 'link-btn';
  viewBtn.textContent = 'View';
  viewBtn.addEventListener('click', () => openSubmissionDetail(sub));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'link-btn';
  deleteBtn.style.color = 'var(--color-error)';
  deleteBtn.style.marginLeft = '10px';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => deleteSubmission(sub));

  detailsTd.appendChild(viewBtn);
  detailsTd.appendChild(deleteBtn);

  tr.appendChild(dateTd);
  tr.appendChild(businessTd);
  tr.appendChild(contactTd);
  tr.appendChild(agentTd);
  tr.appendChild(phoneTd);
  tr.appendChild(custTd);
  tr.appendChild(regionTd);
  tr.appendChild(statusTd);
  tr.appendChild(detailsTd);
  return tr;
}

// ===== Pagination =====
function renderSubmissionsPagination(totalCount) {
  const pager = document.getElementById('submissions-pagination');
  const totalPages = Math.ceil(totalCount / SUBMISSIONS_PAGE_SIZE);

  if (totalPages <= 1) {
    pager.innerHTML = '';
    return;
  }

  pager.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.textContent = 'Previous';
  prevBtn.disabled = submissionsPage === 0;
  prevBtn.addEventListener('click', () => {
    submissionsPage -= 1;
    loadSubmissions();
  });
  pager.appendChild(prevBtn);

  const pageLabel = document.createElement('button');
  pageLabel.textContent = `Page ${submissionsPage + 1} of ${totalPages}`;
  pageLabel.className = 'current';
  pageLabel.disabled = true;
  pager.appendChild(pageLabel);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next';
  nextBtn.disabled = submissionsPage >= totalPages - 1;
  nextBtn.addEventListener('click', () => {
    submissionsPage += 1;
    loadSubmissions();
  });
  pager.appendChild(nextBtn);
}

async function deleteSubmission(sub) {
  const confirmed = await askConfirm(
    `Delete submission ${sub.submission_ref} (${sub.business_name})? This cannot be undone. The deletion will be recorded in the audit log.`
  );
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('submissions')
    .delete()
    .eq('id', sub.id);

  if (error) {
    setSubmissionsMessage('Could not delete submission: ' + error.message, 'error');
    return;
  }

  setSubmissionsMessage(`Submission ${sub.submission_ref} deleted.`, 'success');
  // Reload the current filtered view so the deleted row disappears.
  await loadSubmissions();
}

// ===== Submission detail modal =====
const submissionDetailOverlay = document.getElementById('submission-detail-overlay');
const submissionDetailContent = document.getElementById('submission-detail-content');
document.getElementById('submission-detail-close-btn').addEventListener('click', closeSubmissionDetail);
submissionDetailOverlay.addEventListener('click', (e) => {
  if (e.target === submissionDetailOverlay) closeSubmissionDetail();
});

function closeSubmissionDetail() {
  submissionDetailOverlay.hidden = true;
}

async function openSubmissionDetail(sub) {
  submissionDetailContent.innerHTML = '<p style="padding:16px; color:var(--color-text-muted)">Loading...</p>';
  submissionDetailOverlay.hidden = false;

  // Fetch fresh data for this specific submission rather than relying on the
  // cached row from when the table last loaded — ensures photo, geolocation,
  // and brand joins are always current, regardless of when the table was last
  // refreshed or whether schema cache has been reloaded since.
  const { data: freshSub, error } = await supabaseClient
    .from('submissions')
    .select(`
      id, submission_ref, contact_name, business_name, business_address,
      phone_number, years_in_business, customers_per_day, respondent_age,
      mechanic_count, land_ownership, region, previous_training, notes, status,
      submitted_at, created_at,
      users:user_id ( id, name, email ),
      photos ( id, file_path, file_size_bytes, mime_type ),
      geolocations ( latitude, longitude, accuracy_meters, captured_at ),
      submission_brands ( rank, brands ( name ) )
    `)
    .eq('id', sub.id)
    .single();

  if (error || !freshSub) {
    submissionDetailContent.innerHTML = `<p style="padding:16px; color:var(--color-error)">Could not load submission details.</p>`;
    return;
  }

  // Use the freshly-fetched row from here on.
  sub = freshSub;

  submissionDetailContent.innerHTML = '';

  // Business details section
  const bizSection = document.createElement('div');
  bizSection.className = 'detail-section';
  bizSection.innerHTML = '<h3>Business details</h3>';
  [
    ['Submission ref', sub.submission_ref],
    ['Business name', sub.business_name],
    ['Contact name', sub.contact_name],
    ['Address', sub.business_address],
    ['Phone', sub.phone_number],
    ['Years in business', sub.years_in_business],
    ['Customers/day', sub.customers_per_day],
    ['Respondent age', sub.respondent_age ?? '—'],
    ['Mechanics in workshop', sub.mechanic_count ?? '—'],
    ['Land ownership', sub.land_ownership || '—'],
    ['Previous training', sub.previous_training || 'None'],
    ['Field user', sub.users ? (sub.users.name || sub.users.email) : 'Unknown'],
    ['Region', sub.region],
    ['Submitted', sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : '—'],
    ['Status', sub.status]
  ].forEach(([label, value]) => bizSection.appendChild(buildDetailRow(label, value)));
  if (sub.notes) {
    bizSection.appendChild(buildDetailRow('Notes', sub.notes));
  }
  submissionDetailContent.appendChild(bizSection);

  // Brands section
  const brandsSection = document.createElement('div');
  brandsSection.className = 'detail-section';
  brandsSection.innerHTML = '<h3>Brands serviced</h3>';
  const brandEntries = Array.isArray(sub.submission_brands) && sub.submission_brands.length > 0
    ? sub.submission_brands
        .sort((a, b) => a.rank - b.rank)
        .map(sb => sb.brands ? sb.brands.name : '—')
    : null;
  if (brandEntries) {
    brandEntries.forEach((name, idx) => {
      brandsSection.appendChild(buildDetailRow(`Brand ${idx + 1}`, name));
    });
  } else {
    const note = document.createElement('p');
    note.className = 'detail-no-location';
    note.textContent = 'No brands recorded for this submission.';
    brandsSection.appendChild(note);
  }
  submissionDetailContent.appendChild(brandsSection);

  // Photo section
  const photoSection = document.createElement('div');
  photoSection.className = 'detail-section';
  photoSection.innerHTML = '<h3>Photo</h3>';
  const photo = sub.photos && sub.photos[0];
  if (photo) {
    const { data: signedUrlData } = await supabaseClient.storage
      .from('submission-photos')
      .createSignedUrl(photo.file_path, 300);

    if (signedUrlData && signedUrlData.signedUrl) {
      const img = document.createElement('img');
      img.className = 'detail-photo';
      img.src = signedUrlData.signedUrl;
      img.alt = `Photo for ${sub.business_name}`;
      photoSection.appendChild(img);
    } else {
      const note = document.createElement('p');
      note.className = 'detail-no-photo';
      note.textContent = 'Photo on file, but could not load preview.';
      photoSection.appendChild(note);
    }
  } else {
    const note = document.createElement('p');
    note.className = 'detail-no-photo';
    note.textContent = 'No photo recorded for this submission.';
    photoSection.appendChild(note);
  }
  submissionDetailContent.appendChild(photoSection);

  // Geolocation section
  const geoSection = document.createElement('div');
  geoSection.className = 'detail-section';
  geoSection.innerHTML = '<h3>Geolocation</h3>';
  // geolocations is returned as a plain object (not an array) because
  // submission_id has a unique constraint, so PostgREST treats this as
  // a one-to-one relationship.
  const geo = sub.geolocations && typeof sub.geolocations === 'object' && !Array.isArray(sub.geolocations)
    ? sub.geolocations
    : (Array.isArray(sub.geolocations) ? sub.geolocations[0] : null);
  if (geo) {
    [
      ['Latitude', geo.latitude],
      ['Longitude', geo.longitude],
      ['Accuracy', `±${Math.round(geo.accuracy_meters || 0)}m`],
      ['Captured', new Date(geo.captured_at).toLocaleString()]
    ].forEach(([label, value]) => geoSection.appendChild(buildDetailRow(label, value)));
  } else {
    const note = document.createElement('p');
    note.className = 'detail-no-location';
    note.textContent = 'No location recorded for this submission.';
    geoSection.appendChild(note);
  }
  submissionDetailContent.appendChild(geoSection);
}

function buildDetailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'detail-row-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'detail-row-value';
  valueEl.textContent = (value === null || value === undefined || value === '') ? '—' : value;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

// ===== CSV export =====
document.getElementById('submissions-export-btn').addEventListener('click', exportSubmissionsCsv);

async function exportSubmissionsCsv() {
  const btn = document.getElementById('submissions-export-btn');
  btn.disabled = true;
  btn.textContent = 'Exporting...';
  setSubmissionsMessage('', null);

  try {
    // Export respects whatever filters are currently applied, and pulls
    // every matching row (not just the current page) by querying without
    // the range() limit.
    const { data, error } = await buildSubmissionsQuery(lastSubmissionsFilters, { forExport: true });

    if (error) throw error;
    if (!data || data.length === 0) {
      setSubmissionsMessage('No submissions to export with the current filters.', 'error');
      return;
    }

    const headers = [
      'Submission Ref', 'Business Name', 'Contact Name', 'Business Address',
      'Phone Number', 'Years In Business', 'Customers Per Day',
      'Respondent Age', 'Mechanics In Workshop', 'Land Ownership', 'Region', 'Previous Training',
      'Notes', 'Field User Name', 'Field User Email', 'Status', 'Submitted At', 'Created At',
      'Brands Serviced', 'Photo File Path', 'Photo Size Bytes', 'Latitude', 'Longitude',
      'Location Accuracy (m)', 'Location Captured At'
    ];

    const rows = data.map(sub => {
      const photo = Array.isArray(sub.photos) ? sub.photos[0] : sub.photos;
      const geo = sub.geolocations && !Array.isArray(sub.geolocations)
        ? sub.geolocations
        : (Array.isArray(sub.geolocations) ? sub.geolocations[0] : null);
      const brands = Array.isArray(sub.submission_brands) && sub.submission_brands.length > 0
        ? sub.submission_brands
            .sort((a, b) => a.rank - b.rank)
            .map(sb => sb.brands ? sb.brands.name : '')
            .filter(Boolean)
            .join('; ')
        : '';
      return [
        sub.submission_ref, sub.business_name, sub.contact_name, sub.business_address,
        sub.phone_number, sub.years_in_business, sub.customers_per_day,
        sub.respondent_age ?? '', sub.mechanic_count ?? '',
        sub.land_ownership || '', sub.region || '', sub.previous_training || '',
        sub.notes || '',
        sub.users ? (sub.users.name || '') : '', sub.users ? (sub.users.email || '') : '',
        sub.status, sub.submitted_at || '', sub.created_at,
        brands,
        photo ? photo.file_path : '', photo ? photo.file_size_bytes : '',
        geo ? geo.latitude : '', geo ? geo.longitude : '',
        geo ? geo.accuracy_meters : '', geo ? geo.captured_at : ''
      ];
    });

    const csv = buildCsv(headers, rows);
    downloadCsv(csv, `bmc-submissions-${new Date().toISOString().slice(0, 10)}.csv`);

    setSubmissionsMessage(`Exported ${data.length} submission${data.length === 1 ? '' : 's'}.`, 'success');
  } catch (err) {
    setSubmissionsMessage('Export failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export CSV';
  }
}

// Escapes a single CSV field: wraps in quotes if it contains a comma,
// quote, or newline, and doubles any internal quotes per RFC 4180.
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach(row => lines.push(row.map(csvEscape).join(',')));
  return lines.join('\r\n');
}

function downloadCsv(csvContent, filename) {
  // Leading BOM so Excel correctly detects UTF-8 rather than misreading
  // accented characters in business/contact names.
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ===== Brands panel =====
function setBrandsMessage(message, type) {
  const el = document.getElementById('brands-message');
  el.textContent = message;
  el.className = 'panel-message' + (type ? ' ' + type : '');
}

async function loadBrandsPanel() {
  const tbody = document.getElementById('brands-table-body');
  tbody.innerHTML = '<tr><td colspan="4" class="table-loading">Loading brands...</td></tr>';

  const { data, error } = await supabaseClient
    .from('brands')
    .select('id, name, active, created_at')
    .order('name');

  if (error) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Could not load brands.</td></tr>';
    setBrandsMessage('Could not load brands: ' + error.message, 'error');
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No brands yet. Add one above.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  data.forEach(brand => tbody.appendChild(buildBrandRow(brand)));
}

function buildBrandRow(brand) {
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  nameTd.setAttribute('data-label', 'Name');
  nameTd.textContent = brand.name;

  const statusTd = document.createElement('td');
  statusTd.setAttribute('data-label', 'Status');
  const badge = document.createElement('span');
  badge.className = `badge ${brand.active ? 'status-active' : 'status-inactive'}`;
  badge.textContent = brand.active ? 'Active' : 'Inactive';
  statusTd.appendChild(badge);

  const addedTd = document.createElement('td');
  addedTd.setAttribute('data-label', 'Added');
  addedTd.textContent = brand.created_at ? new Date(brand.created_at).toLocaleDateString() : '—';

  const actionsTd = document.createElement('td');
  actionsTd.setAttribute('data-label', 'Actions');
  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = `btn-sm ${brand.active ? 'deactivate' : 'activate'}`;
  actionBtn.textContent = brand.active ? 'Deactivate' : 'Reactivate';
  actionBtn.addEventListener('click', () => toggleBrandActive(brand));
  actionsTd.appendChild(actionBtn);

  tr.appendChild(nameTd);
  tr.appendChild(statusTd);
  tr.appendChild(addedTd);
  tr.appendChild(actionsTd);
  return tr;
}

document.getElementById('add-brand-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('new-brand-name');
  const name = input.value.trim();
  if (!name) return;

  setBrandsMessage('', null);

  // Friendly client-side duplicate check before hitting the DB's unique
  // constraint, so the error message is clearer than a raw constraint violation.
  const { data: existing } = await supabaseClient
    .from('brands')
    .select('id, active')
    .ilike('name', name)
    .maybeSingle();

  if (existing) {
    setBrandsMessage(
      existing.active
        ? `"${name}" already exists in the brand list.`
        : `"${name}" already exists but is inactive. Reactivate it from the list below instead of adding a duplicate.`,
      'error'
    );
    return;
  }

  const { error } = await supabaseClient.from('brands').insert({ name, active: true });

  if (error) {
    setBrandsMessage('Could not add brand: ' + error.message, 'error');
    return;
  }

  input.value = '';
  setBrandsMessage(`"${name}" added.`, 'success');
  await loadBrandsPanel();
});

async function toggleBrandActive(brand) {
  const newState = !brand.active;
  const confirmed = await askConfirm(
    newState
      ? `Reactivate "${brand.name}"? It will appear again in the brand list for new submissions.`
      : `Deactivate "${brand.name}"? It will no longer appear for new submissions, but past records referencing it are unaffected.`
  );
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('brands')
    .update({ active: newState })
    .eq('id', brand.id);

  if (error) {
    setBrandsMessage('Could not update brand: ' + error.message, 'error');
    return;
  }

  setBrandsMessage(`"${brand.name}" ${newState ? 'reactivated' : 'deactivated'}.`, 'success');
  await loadBrandsPanel();
}

// ===== Init =====
checkAuth();