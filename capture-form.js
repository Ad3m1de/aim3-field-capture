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
  document.getElementById('town').value = fd.town || '';
  document.getElementById('state').value = fd.state || '';
  document.getElementById('phone-number').value = fd.phone_number || '';
  document.getElementById('years-in-business').value = fd.years_in_business ?? '';
  document.getElementById('customers-per-day').value = fd.customers_per_day ?? '';
  document.getElementById('respondent-age').value = fd.respondent_age ?? '';
  document.getElementById('mechanic-count').value = fd.mechanic_count ?? '';
  document.getElementById('land-ownership').value = fd.land_ownership || '';
  document.getElementById('region').value = fd.region || '';
  document.getElementById('notes').value = fd.notes || '';

  // Restore previous training toggle
  const trainingToggle = document.getElementById('previous-training-toggle');
  const trainingField = document.getElementById('previous-training-field');
  const trainingInput = document.getElementById('previous-training');
  if (fd.previous_training) {
    trainingToggle.value = 'yes';
    trainingField.hidden = false;
    trainingInput.required = true;
    trainingInput.value = fd.previous_training;
  } else {
    trainingToggle.value = 'no';
    trainingField.hidden = true;
    trainingInput.required = false;
    trainingInput.value = '';
  }

  const brandIds = fd.brand_ids || [];
  document.getElementById('brand-1').value = brandIds[0] || '';
  document.getElementById('brand-2').value = brandIds[1] || '';
  document.getElementById('brand-3').value = brandIds[2] || '';

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

  await loadBrands();
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

// ===== Load brands into the three dropdowns =====
async function loadBrands() {
  const { data: brands, error } = await supabaseClient
    .from('brands')
    .select('id, name')
    .eq('active', true)
    .order('name');

  const selects = [
    document.getElementById('brand-1'),
    document.getElementById('brand-2'),
    document.getElementById('brand-3')
  ];

  if (error || !brands) {
    // Offline or load failure — leave selects with just the placeholder.
    // Field agent can still fill in everything else and sync later, though
    // they won't be able to pick a brand until the list is reachable.
    return;
  }

  selects.forEach(select => {
    brands.forEach(brand => {
      const opt = document.createElement('option');
      opt.value = brand.id;
      opt.textContent = brand.name;
      select.appendChild(opt);
    });
  });
}

// ===== Previous training toggle =====
document.getElementById('previous-training-toggle').addEventListener('change', function () {
  const trainingField = document.getElementById('previous-training-field');
  const trainingInput = document.getElementById('previous-training');
  const show = this.value === 'yes';
  trainingField.hidden = !show;
  trainingInput.required = show;
  if (!show) {
    trainingInput.value = '';
    setFieldError('previous-training', 'previous-training-error', '');
  }
});
const photoInput = document.getElementById('photo-input');
const photoPreviewWrap = document.getElementById('photo-preview-wrap');
const photoPreview = document.getElementById('photo-preview');
const locationDot = document.getElementById('location-dot');
const locationText = document.getElementById('location-text');

photoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  setFieldError('photo-input', 'photo-error', '');

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

  // Try EXIF GPS first — this reflects where the photo was actually taken,
  // not where the device is now at upload time, which is the more meaningful
  // location for field visit data.
  await captureLocation(file);
});

async function captureLocation(photoFile) {
  locationDot.className = 'location-dot';
  locationText.textContent = 'Reading location from photo...';

  // Step 1: Try EXIF GPS data embedded in the photo.
  try {
    if (typeof exifr !== 'undefined') {
      const gps = await exifr.gps(photoFile);
      if (gps && gps.latitude && gps.longitude) {
        capturedLocation = {
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracy: null, // EXIF doesn't include accuracy
          capturedAt: new Date().toISOString(),
          source: 'exif'
        };
        locationDot.className = 'location-dot captured';
        locationText.textContent = 'Location read from photo metadata.';
        return;
      }
    }
  } catch (err) {
    // EXIF parsing failed or no GPS data — fall through to device geolocation.
  }

  // Step 2: Fall back to device geolocation if EXIF has no GPS data.
  locationText.textContent = 'No GPS in photo — capturing device location...';

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
        capturedAt: new Date().toISOString(),
        source: 'device'
      };
      locationDot.className = 'location-dot captured';
      locationText.textContent = `Device location captured (±${Math.round(position.coords.accuracy)}m). Note: reflects upload location, not where photo was taken.`;
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
  const town = document.getElementById('town').value.trim();
  const state = document.getElementById('state').value.trim();  
  const phoneNumber = document.getElementById('phone-number').value.trim();
  const yearsInBusiness = document.getElementById('years-in-business').value;
  const customersPerDay = document.getElementById('customers-per-day').value;
  const brand1 = document.getElementById('brand-1').value;

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

if (!town) {
    setFieldError('town', 'town-error', 'Enter the town where your business is located.');
    valid = false;
  } else {
    setFieldError('town', 'town-error', '');
  }


  if (!state) {
    setFieldError('state', 'state-error', 'Enter the state where your business is located.');
    valid = false;
  } else {
    setFieldError('state', 'state-error', '');
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

  const respondentAge = document.getElementById('respondent-age').value;
  if (respondentAge === '' || Number(respondentAge) < 18 || Number(respondentAge) > 100) {
    setFieldError('respondent-age', 'respondent-age-error', 'Enter a valid age (18–100).');
    valid = false;
  } else {
    setFieldError('respondent-age', 'respondent-age-error', '');
  }

  const mechanicCount = document.getElementById('mechanic-count').value;
  if (mechanicCount === '' || Number(mechanicCount) < 0) {
    setFieldError('mechanic-count', 'mechanic-count-error', 'Enter the number of mechanics.');
    valid = false;
  } else {
    setFieldError('mechanic-count', 'mechanic-count-error', '');
  }

  const landOwnership = document.getElementById('land-ownership').value;
  if (!landOwnership) {
    setFieldError('land-ownership', 'land-ownership-error', 'Select an ownership type.');
    valid = false;
  } else {
    setFieldError('land-ownership', 'land-ownership-error', '');
  }

  const region = document.getElementById('region').value;
  if (!region) {
    setFieldError('region', 'region-error', 'Select a region.');
    valid = false;
  } else {
    setFieldError('region', 'region-error', '');
  }
  const trainingToggle = document.getElementById('previous-training-toggle').value;
  if (trainingToggle === 'yes') {
    const trainingText = document.getElementById('previous-training').value.trim();
    if (!trainingText) {
      setFieldError('previous-training', 'previous-training-error', 'Enter the training name.');
      valid = false;
    } else {
      setFieldError('previous-training', 'previous-training-error', '');
    }
  }

  if (!brand1) {
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
  const trainingToggle = document.getElementById('previous-training-toggle').value;
  const trainingText = trainingToggle === 'yes'
    ? document.getElementById('previous-training').value.trim()
    : null;

  return {
    submission_ref: document.getElementById('submission-ref').textContent,
    contact_name: document.getElementById('contact-name').value.trim(),
    business_name: document.getElementById('business-name').value.trim(),
    business_address: document.getElementById('business-address').value.trim(),
    town: document.getElementById('town').value.trim(),
    state: document.getElementById('state').value.trim(),
    phone_number: document.getElementById('phone-number').value.trim(),
    years_in_business: Number(document.getElementById('years-in-business').value),
    customers_per_day: Number(document.getElementById('customers-per-day').value),
    respondent_age: Number(document.getElementById('respondent-age').value),
    mechanic_count: Number(document.getElementById('mechanic-count').value),
    land_ownership: document.getElementById('land-ownership').value,
    region: document.getElementById('region').value,
    previous_training: trainingText,
    notes: document.getElementById('notes').value.trim(),
    brand_ids: [
      document.getElementById('brand-1').value,
      document.getElementById('brand-2').value,
      document.getElementById('brand-3').value
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
      town: formData.town,
      state: formData.state,
      phone_number: formData.phone_number,
      years_in_business: formData.years_in_business,
      customers_per_day: formData.customers_per_day,
      respondent_age: formData.respondent_age || null,
      mechanic_count: formData.mechanic_count ?? null,
      land_ownership: formData.land_ownership || null,
      region: formData.region,
      previous_training: formData.previous_training || null,
      notes: formData.notes || null,
      status: 'submitted',
      submitted_at: formData.captured_at,
      created_at: formData.captured_at,
      synced_at: new Date().toISOString()
    })
    .select()
    .single();

  if (subError) throw subError;

  // 2. Link brands.
  if (formData.brand_ids.length > 0) {
    const brandRows = formData.brand_ids.map((brandId, idx) => ({
      submission_id: submission.id,
      brand_id: brandId,
      rank: idx + 1
    }));
    const { error: brandError } = await supabaseClient.from('submission_brands').insert(brandRows);
    if (brandError) throw brandError;
  }

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
    await saveAsLocalDraft(formData, capturedPhotoFile, 'offline');
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
    await saveAsLocalDraft(formData, capturedPhotoFile, 'offline');
  }
});

// ===== Save as draft button =====
document.getElementById('save-draft-btn').addEventListener('click', async () => {
  const formData = collectFormData();
  await saveAsLocalDraft(formData, capturedPhotoFile);
  await refreshDraftsBadge();

  // Reset the form completely so the agent can start a fresh visit —
  // same as after a real submission, but without showing the success screen.
  document.getElementById('capture-form').reset();
  document.getElementById('submission-ref').textContent = generateSubmissionRef();
  capturedPhotoFile = null;
  capturedLocation = null;
  editingDraftLocalId = null;
  document.getElementById('photo-preview-wrap').hidden = true;
  document.getElementById('photo-preview').src = '';
  document.getElementById('location-dot').className = 'location-dot';
  document.getElementById('location-text').textContent = 'Location will be captured with your photo';
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));

  setFormMessage('Draft saved. You can access it from the Drafts button above.', 'success');
  setTimeout(() => setFormMessage('', null), 4000);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function saveAsLocalDraft(formData, photoFile, draftType = 'manual') {
  let photoDataUrl = null;
  if (photoFile) {
    photoDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(photoFile);
    });
  }

  const localId = editingDraftLocalId || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const draft = {
    localId,
    formData,
    photoDataUrl,
    photoType: photoFile ? photoFile.type : null,
    savedAt: new Date().toISOString(),
    // 'offline' = was a real submit attempt while offline, should auto-sync
    // 'manual'  = explicitly saved as draft, only syncs when user submits it
    draftType
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

  // Only auto-sync drafts that were queued because the device was offline
  // during a real submit attempt. Manual drafts (saved via "Save as draft"
  // button) stay local until the agent explicitly edits and submits them.
  const offlineDrafts = drafts.filter(d => d.draftType === 'offline');
  if (offlineDrafts.length === 0) return;

  for (const draft of offlineDrafts) {
    try {
      const dupCheck = await checkForDuplicate(draft.formData);
      if (dupCheck.checked && dupCheck.isDuplicate) {
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

function resetForm() {
  // Reset all form fields
  document.getElementById('capture-form').reset();

  // Generate a fresh submission reference
  document.getElementById('submission-ref').textContent = generateSubmissionRef();

  // Clear in-memory state
  capturedPhotoFile = null;
  capturedLocation = null;
  editingDraftLocalId = null;

  // Reset photo preview
  document.getElementById('photo-preview-wrap').hidden = true;
  document.getElementById('photo-preview').src = '';

  // Reset location indicator
  document.getElementById('location-dot').className = 'location-dot';
  document.getElementById('location-text').textContent = 'Location will be captured with your photo';

  // Clear any lingering messages and validation states
  setFormMessage('', null);
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));

  // Show the form, hide the success screen
  document.getElementById('success-screen').hidden = true;
  document.getElementById('capture-form').hidden = false;

  // Scroll back to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('new-submission-btn').addEventListener('click', resetForm);

// ===== Init =====
checkAuth();