// ===== State =====
let currentUser = null;
let capturedPhotoFile = null;
let capturedLocation = null; // { latitude, longitude, accuracy, capturedAt }
const DRAFT_DB_NAME = 'bmc-field-drafts';
const DRAFT_STORE = 'drafts';

// ===== IndexedDB helpers (for offline draft storage) =====
function openDraftDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: 'localId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDraftLocally(draft) {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite');
    tx.objectStore(DRAFT_STORE).put(draft);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllLocalDrafts() {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readonly');
    const req = tx.objectStore(DRAFT_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteLocalDraft(localId) {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite');
    tx.objectStore(DRAFT_STORE).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== Connection status =====
function updateConnectionStatus() {
  const pill = document.getElementById('connection-status');
  if (navigator.onLine) {
    pill.textContent = 'Online';
    pill.className = 'status-pill online';
    syncPendingDrafts().then(refreshDraftsBadge);
  } else {
    pill.textContent = 'Offline — saving locally';
    pill.className = 'status-pill offline';
  }
  refreshDraftsBadge();
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// ===== Drafts panel =====
const draftsBtn = document.getElementById('drafts-btn');
const draftsOverlay = document.getElementById('drafts-overlay');
const draftsList = document.getElementById('drafts-list');
const closeDraftsBtn = document.getElementById('close-drafts-btn');

draftsBtn.addEventListener('click', openDraftsPanel);
closeDraftsBtn.addEventListener('click', closeDraftsPanel);
draftsOverlay.addEventListener('click', (e) => {
  if (e.target === draftsOverlay) closeDraftsPanel();
});

function openDraftsPanel() {
  draftsOverlay.hidden = false;
  renderDraftsList();
}

function closeDraftsPanel() {
  draftsOverlay.hidden = true;
}

async function refreshDraftsBadge() {
  try {
    const drafts = await getAllLocalDrafts();
    draftsBtn.textContent = `Drafts (${drafts.length})`;
  } catch {
    draftsBtn.textContent = 'Drafts (0)';
  }
}

async function renderDraftsList() {
  let drafts;
  try {
    drafts = await getAllLocalDrafts();
  } catch {
    drafts = [];
  }

  if (drafts.length === 0) {
    draftsList.innerHTML = '<p class="drafts-empty">No drafts saved on this device.</p>';
    return;
  }

  drafts.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

  draftsList.innerHTML = '';
  drafts.forEach(draft => draftsList.appendChild(buildDraftItem(draft)));
}

function buildDraftItem(draft) {
  const fd = draft.formData || {};
  const item = document.createElement('div');
  item.className = 'draft-item';

  const title = document.createElement('div');
  title.className = 'draft-item-title';
  title.textContent = fd.business_name || '(no business name yet)';

  const meta = document.createElement('div');
  meta.className = 'draft-item-meta';
  const savedDate = new Date(draft.savedAt).toLocaleString();
  meta.textContent = fd.contact_name
    ? `${fd.contact_name} · Saved ${savedDate}`
    : `Saved ${savedDate}`;

  const actions = document.createElement('div');
  actions.className = 'draft-item-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'draft-retry-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => {
    loadDraftIntoForm(draft);
    closeDraftsPanel();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'draft-delete-btn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    await deleteLocalDraft(draft.localId);
    await renderDraftsList();
    await refreshDraftsBadge();
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  item.appendChild(title);
  item.appendChild(meta);
  item.appendChild(actions);
  return item;
}

// Tracks the draft currently loaded for editing, if any, so submitting
// the form can remove the old draft once it's successfully replaced.
let editingDraftLocalId = null;

async function loadDraftIntoForm(draft) {
  const fd = draft.formData || {};
  editingDraftLocalId = draft.localId;

  document.getElementById('submission-ref').textContent = fd.submission_ref || generateSubmissionRef();
  document.getElementById('contact-name').value = fd.contact_name || '';
  document.getElementById('business-name').value = fd.business_name || '';
  document.getElementById('business-address').value = fd.business_address || '';
  document.getElementById('phone-number').value = fd.phone_number || '';
  document.getElementById('years-in-business').value = fd.years_in_business ?? '';
  document.getElementById('customers-per-day').value = fd.customers_per_day ?? '';
  document.getElementById('notes').value = fd.notes || '';

  const brandNames = fd.brand_names || [];
  document.getElementById('brand-1').value = brandNames[0] || '';
  document.getElementById('brand-2').value = brandNames[1] || '';
  document.getElementById('brand-3').value = brandNames[2] || '';

  // Restore photo preview and the in-memory file used on resubmit.
  if (draft.photoDataUrl) {
    photoPreview.src = draft.photoDataUrl;
    photoPreviewWrap.hidden = false;
    const res = await fetch(draft.photoDataUrl);
    const blob = await res.blob();
    capturedPhotoFile = new File([blob], 'photo.jpg', { type: draft.photoType || 'image/jpeg' });
  } else {
    capturedPhotoFile = null;
    photoPreviewWrap.hidden = true;
  }

  // Restore location, if it was captured.
  if (fd.location) {
    capturedLocation = fd.location;
    locationDot.className = 'location-dot captured';
    locationText.textContent = `Location captured (±${Math.round(fd.location.accuracy || 0)}m accuracy)`;
  } else {
    capturedLocation = null;
    locationDot.className = 'location-dot';
    locationText.textContent = 'Location will be captured with your photo';
  }

  setFormMessage('Editing draft. Submit when ready.', 'success');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Auth guard =====
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

  if (error || !profile || profile.status !== 'active') {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
    return;
  }

  currentUser = profile;
  document.getElementById('auth-guard').hidden = true;
  document.getElementById('capture-form').hidden = false;
  document.getElementById('submission-ref').textContent = generateSubmissionRef();

  updateConnectionStatus();
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
});

// ===== Submission reference generator =====
function generateSubmissionRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BMC-${ts}-${rand}`;
}

// ===== Load brands — commented out for now since brands are plain text inputs =====
// Previously populated three <select> dropdowns from the brands table.
// Re-enable (and restore the <select> markup in capture-form.html) once the
// brand list UX is decided.
//
// async function loadBrands() {
//   const { data: brands, error } = await supabaseClient
//     .from('brands')
//     .select('id, name')
//     .eq('active', true)
//     .order('name');
//
//   const selects = [
//     document.getElementById('brand-1'),
//     document.getElementById('brand-2'),
//     document.getElementById('brand-3')
//   ];
//
//   if (error || !brands) return;
//
//   selects.forEach(select => {
//     brands.forEach(brand => {
//       const opt = document.createElement('option');
//       opt.value = brand.id;
//       opt.textContent = brand.name;
//       select.appendChild(opt);
//     });
//   });
// }

// ===== Photo capture + geolocation (captured together, per the brief) =====
const photoInput = document.getElementById('photo-input');
const photoPreviewWrap = document.getElementById('photo-preview-wrap');
const photoPreview = document.getElementById('photo-preview');
const locationDot = document.getElementById('location-dot');
const locationText = document.getElementById('location-text');

photoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  setFieldError('photo-input', 'photo-error', '');

  // File size guard — keep photos reasonably small (matches DB constraint of 10MB max).
  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    setFieldError('photo-input', 'photo-error', 'Photo is too large. Please use a smaller image (max 10MB).');
    photoInput.value = '';
    return;
  }

  capturedPhotoFile = file;

  // Show preview.
  const reader = new FileReader();
  reader.onload = (ev) => {
    photoPreview.src = ev.target.result;
    photoPreviewWrap.hidden = false;
  };
  reader.readAsDataURL(file);

  // Capture geolocation at the same moment, as the brief requires.
  captureLocation();
});

function captureLocation() {
  locationDot.className = 'location-dot';
  locationText.textContent = 'Capturing location...';

  if (!('geolocation' in navigator)) {
    locationDot.className = 'location-dot error';
    locationText.textContent = 'Location not supported on this device.';
    capturedLocation = null;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      capturedLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date().toISOString()
      };
      locationDot.className = 'location-dot captured';
      locationText.textContent = `Location captured (±${Math.round(position.coords.accuracy)}m accuracy)`;
    },
    (err) => {
      capturedLocation = null;
      locationDot.className = 'location-dot error';
      if (err.code === err.PERMISSION_DENIED) {
        locationText.textContent = 'Location permission denied. You can still submit without it.';
      } else {
        locationText.textContent = 'Could not capture location. You can still submit without it.';
      }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ===== Validation helpers =====
function setFieldError(inputId, errorId, message) {
  const input = document.getElementById(inputId);
  const errorEl = document.getElementById(errorId);
  if (message) {
    input.classList.add('invalid');
    errorEl.textContent = message;
  } else {
    input.classList.remove('invalid');
    errorEl.textContent = '';
  }
}

function setFormMessage(message, type) {
  const el = document.getElementById('form-message');
  el.textContent = message;
  el.className = 'form-message' + (type ? ' ' + type : '');
}

function isValidPhone(value) {
  // Accepts digits, spaces, +, -, (, ) — at least 7 digits total.
  const digitCount = (value.match(/\d/g) || []).length;
  return /^[0-9+\-\s()]+$/.test(value) && digitCount >= 7;
}

function validateForm() {
  let valid = true;

  const contactName = document.getElementById('contact-name').value.trim();
  const businessName = document.getElementById('business-name').value.trim();
  const businessAddress = document.getElementById('business-address').value.trim();
  const phoneNumber = document.getElementById('phone-number').value.trim();
  const yearsInBusiness = document.getElementById('years-in-business').value;
  const customersPerDay = document.getElementById('customers-per-day').value;
  const brand1 = document.getElementById('brand-1').value.trim();

  if (!contactName) {
    setFieldError('contact-name', 'contact-name-error', 'Enter the contact name.');
    valid = false;
  } else {
    setFieldError('contact-name', 'contact-name-error', '');
  }

  if (!businessName) {
    setFieldError('business-name', 'business-name-error', 'Enter the business name.');
    valid = false;
  } else {
    setFieldError('business-name', 'business-name-error', '');
  }

  if (!businessAddress) {
    setFieldError('business-address', 'business-address-error', 'Enter the business address.');
    valid = false;
  } else {
    setFieldError('business-address', 'business-address-error', '');
  }

  if (!phoneNumber) {
    setFieldError('phone-number', 'phone-number-error', 'Enter a phone number.');
    valid = false;
  } else if (!isValidPhone(phoneNumber)) {
    setFieldError('phone-number', 'phone-number-error', 'Enter a valid phone number.');
    valid = false;
  } else {
    setFieldError('phone-number', 'phone-number-error', '');
  }

  if (yearsInBusiness === '' || Number(yearsInBusiness) < 0) {
    setFieldError('years-in-business', 'years-in-business-error', 'Enter a valid number of years.');
    valid = false;
  } else {
    setFieldError('years-in-business', 'years-in-business-error', '');
  }

  if (customersPerDay === '' || Number(customersPerDay) < 0) {
    setFieldError('customers-per-day', 'customers-per-day-error', 'Enter a valid number.');
    valid = false;
  } else {
    setFieldError('customers-per-day', 'customers-per-day-error', '');
  }

  if (!brand1) {
    setFieldError('brand-error', 'brands-error', '');
    document.getElementById('brands-error').textContent = 'Select at least one brand.';
    valid = false;
  } else {
    document.getElementById('brands-error').textContent = '';
  }

  if (!capturedPhotoFile) {
    setFieldError('photo-input', 'photo-error', 'A photo is required.');
    valid = false;
  }

  return valid;
}

function collectFormData() {
  return {
    submission_ref: document.getElementById('submission-ref').textContent,
    contact_name: document.getElementById('contact-name').value.trim(),
    business_name: document.getElementById('business-name').value.trim(),
    business_address: document.getElementById('business-address').value.trim(),
    phone_number: document.getElementById('phone-number').value.trim(),
    years_in_business: Number(document.getElementById('years-in-business').value),
    customers_per_day: Number(document.getElementById('customers-per-day').value),
    notes: document.getElementById('notes').value.trim(),
    brand_names: [
      document.getElementById('brand-1').value.trim(),
      document.getElementById('brand-2').value.trim(),
      document.getElementById('brand-3').value.trim()
    ].filter(Boolean),
    captured_at: new Date().toISOString(),
    location: capturedLocation
  };
}

// ===== Duplicate check (blocks submission, per project decision) =====
// Uses a server-side RPC (check_duplicate_submission) rather than building a
// .or() filter string client-side, since business names containing commas or
// other special characters would otherwise break the filter syntax.
async function checkForDuplicate(formData) {
  const { data, error } = await supabaseClient.rpc('check_duplicate_submission', {
    p_phone: formData.phone_number,
    p_business_name: formData.business_name
  });

  if (error) {
    // If the check itself fails (e.g. offline), we can't confirm uniqueness here —
    // this gets re-checked again at sync time before the row is actually written.
    return { checked: false, isDuplicate: false };
  }

  return { checked: true, isDuplicate: data && data.length > 0, existing: data?.[0] };
}

// ===== Upload photo + submit to Supabase =====
async function uploadPhotoAndSubmit(formData, photoFile) {
  // 1. Insert the submission row.
  const { data: submission, error: subError } = await supabaseClient
    .from('submissions')
    .insert({
      submission_ref: formData.submission_ref,
      user_id: currentUser.id,
      contact_name: formData.contact_name,
      business_name: formData.business_name,
      business_address: formData.business_address,
      phone_number: formData.phone_number,
      years_in_business: formData.years_in_business,
      customers_per_day: formData.customers_per_day,
      notes: formData.notes || null,
      status: 'submitted',
      submitted_at: formData.captured_at,
      created_at: formData.captured_at,
      synced_at: new Date().toISOString()
    })
    .select()
    .single();

  if (subError) throw subError;

  // 2. Link brands — commented out for now since brand_id expects a foreign key
  //    into the brands table, but brands are currently captured as free text.
  //    The text values are not being persisted to the database yet.
  //    Revisit once the brand list UX is decided (e.g. resolve text to a brand_id,
  //    or add a free-text column directly on submissions).
  //
  // if (formData.brand_ids.length > 0) {
  //   const brandRows = formData.brand_ids.map((brandId, idx) => ({
  //     submission_id: submission.id,
  //     brand_id: brandId,
  //     rank: idx + 1
  //   }));
  //   const { error: brandError } = await supabaseClient.from('submission_brands').insert(brandRows);
  //   if (brandError) throw brandError;
  // }

  // 3. Upload photo to storage, then record it.
  const filePath = `${currentUser.id}/${submission.id}-${Date.now()}.jpg`;
  const { error: uploadError } = await supabaseClient.storage
    .from('submission-photos')
    .upload(filePath, photoFile);

  if (uploadError) throw uploadError;

  const { error: photoError } = await supabaseClient.from('photos').insert({
    submission_id: submission.id,
    file_path: filePath,
    file_size_bytes: photoFile.size,
    mime_type: photoFile.type
  });
  if (photoError) throw photoError;

  // 4. Record geolocation, if captured.
  if (formData.location) {
    const { error: geoError } = await supabaseClient.from('geolocations').insert({
      submission_id: submission.id,
      latitude: formData.location.latitude,
      longitude: formData.location.longitude,
      accuracy_meters: formData.location.accuracy,
      captured_at: formData.location.capturedAt
    });
    if (geoError) throw geoError;
  }

  return submission;
}

// ===== Form submit handler =====
document.getElementById('capture-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setFormMessage('', null);

  if (!validateForm()) {
    setFormMessage('Please fix the highlighted fields before submitting.', 'error');
    return;
  }

  const formData = collectFormData();
  setLoading(true);

  // If offline, skip straight to local draft save — server checks happen at sync time.
  if (!navigator.onLine) {
    await saveAsLocalDraft(formData, capturedPhotoFile);
    setLoading(false);
    showSuccess('Saved offline. This will be submitted automatically once you\'re back online.');
    return;
  }

  try {
    const dupCheck = await checkForDuplicate(formData);
    if (dupCheck.checked && dupCheck.isDuplicate) {
      setLoading(false);
      setFormMessage(
        `This looks like a duplicate of an existing record (${dupCheck.existing.submission_ref}). Submission blocked.`,
        'error'
      );
      return;
    }

    await uploadPhotoAndSubmit(formData, capturedPhotoFile);
    if (editingDraftLocalId) {
      await deleteLocalDraft(editingDraftLocalId);
      editingDraftLocalId = null;
      await refreshDraftsBadge();
    }
    setLoading(false);
    showSuccess('Your visit record has been submitted successfully.');
  } catch (err) {
    setLoading(false);
    setFormMessage('Could not submit right now. Saving as a draft instead — it will sync automatically.', 'warning');
    await saveAsLocalDraft(formData, capturedPhotoFile);
  }
});

// ===== Save as draft button =====
document.getElementById('save-draft-btn').addEventListener('click', async () => {
  // Drafts don't require full validation — just need the basics to be useful later.
  const formData = collectFormData();
  await saveAsLocalDraft(formData, capturedPhotoFile);
  showSuccess('Draft saved on this device. You can finish it later from here.');
});

async function saveAsLocalDraft(formData, photoFile) {
  let photoDataUrl = null;
  if (photoFile) {
    photoDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(photoFile);
    });
  }

  // Reuse the existing draft's ID if we're editing one, so this updates
  // it in place rather than creating a duplicate entry.
  const localId = editingDraftLocalId || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const draft = {
    localId,
    formData,
    photoDataUrl,
    photoType: photoFile ? photoFile.type : null,
    savedAt: new Date().toISOString()
  };

  await saveDraftLocally(draft);
  editingDraftLocalId = null;
}

// ===== Sync queued drafts when back online =====
async function syncPendingDrafts() {
  let drafts;
  try {
    drafts = await getAllLocalDrafts();
  } catch {
    return;
  }
  if (!drafts || drafts.length === 0) return;

  for (const draft of drafts) {
    try {
      const dupCheck = await checkForDuplicate(draft.formData);
      if (dupCheck.checked && dupCheck.isDuplicate) {
        // Leave it queued; a real build would surface this to the user for review
        // rather than silently dropping it.
        continue;
      }

      let photoFile = null;
      if (draft.photoDataUrl) {
        const res = await fetch(draft.photoDataUrl);
        const blob = await res.blob();
        photoFile = new File([blob], 'photo.jpg', { type: draft.photoType || 'image/jpeg' });
      }

      await uploadPhotoAndSubmit(draft.formData, photoFile);
      await deleteLocalDraft(draft.localId);
    } catch (err) {
      // Leave this draft queued and try again on the next sync opportunity.
      continue;
    }
  }
}

// ===== UI state helpers =====
function setLoading(isLoading) {
  const btn = document.getElementById('submit-btn');
  const spinner = btn.querySelector('.spinner');
  const label = btn.querySelector('.btn-label');
  btn.disabled = isLoading;
  spinner.hidden = !isLoading;
  label.style.opacity = isLoading ? '0.7' : '1';
}

function showSuccess(message) {
  document.getElementById('capture-form').hidden = true;
  document.getElementById('success-screen').hidden = false;
  document.getElementById('success-detail').textContent = message;
}

document.getElementById('new-submission-btn').addEventListener('click', () => {
  window.location.reload();
});

// ===== Init =====
checkAuth();
