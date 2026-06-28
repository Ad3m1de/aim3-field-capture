// --- Tab switching ---
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');

function showLogin() {
  tabLogin.classList.add('active');
  tabSignup.classList.remove('active');
  tabLogin.setAttribute('aria-selected', 'true');
  tabSignup.setAttribute('aria-selected', 'false');
  loginForm.hidden = false;
  signupForm.hidden = true;
}

function showSignup() {
  tabSignup.classList.add('active');
  tabLogin.classList.remove('active');
  tabSignup.setAttribute('aria-selected', 'true');
  tabLogin.setAttribute('aria-selected', 'false');
  signupForm.hidden = false;
  loginForm.hidden = true;
}

tabLogin.addEventListener('click', showLogin);
tabSignup.addEventListener('click', showSignup);

// --- Helpers ---
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

function setFormMessage(messageId, message, type) {
  const el = document.getElementById(messageId);
  el.textContent = message;
  el.className = 'form-message' + (type ? ' ' + type : '');
}

function setLoading(buttonId, isLoading) {
  const btn = document.getElementById(buttonId);
  const spinner = btn.querySelector('.spinner');
  const label = btn.querySelector('.btn-label');
  btn.disabled = isLoading;
  spinner.hidden = !isLoading;
  label.style.opacity = isLoading ? '0.7' : '1';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- Login ---
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  setFieldError('login-email', 'login-email-error', '');
  setFieldError('login-password', 'login-password-error', '');
  setFormMessage('login-message', '', null);

  let hasError = false;
  if (!email) {
    setFieldError('login-email', 'login-email-error', 'Enter your email.');
    hasError = true;
  } else if (!isValidEmail(email)) {
    setFieldError('login-email', 'login-email-error', 'Enter a valid email address.');
    hasError = true;
  }
  if (!password) {
    setFieldError('login-password', 'login-password-error', 'Enter your password.');
    hasError = true;
  }
  if (hasError) return;

  setLoading('login-submit', true);

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  setLoading('login-submit', false);

  if (error) {
    setFormMessage('login-message', error.message || 'Could not log in. Check your details and try again.', 'error');
    return;
  }

  // Check the user's profile status before letting them in.
  const userId = data.user.id;
  const { data: profile, error: profileError } = await supabaseClient
    .from('users')
    .select('status, role')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    setFormMessage('login-message', 'Could not load your account. Contact an administrator.', 'error');
    await supabaseClient.auth.signOut();
    return;
  }

  if (profile.status === 'pending') {
    setFormMessage('login-message', 'Your account is awaiting admin approval.', 'error');
    await supabaseClient.auth.signOut();
    return;
  }

  if (profile.status === 'inactive') {
    setFormMessage('login-message', 'Your account has been deactivated. Contact an administrator.', 'error');
    await supabaseClient.auth.signOut();
    return;
  }

  setFormMessage('login-message', 'Logged in. Redirecting...', 'success');

  // Route based on role.
  window.location.href = profile.role === 'admin' ? 'admin-dashboard.html' : 'capture-form.html';
});

// --- Sign up ---
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;

  setFieldError('signup-name', 'signup-name-error', '');
  setFieldError('signup-email', 'signup-email-error', '');
  setFieldError('signup-password', 'signup-password-error', '');
  setFormMessage('signup-message', '', null);

  let hasError = false;
  if (!name) {
    setFieldError('signup-name', 'signup-name-error', 'Enter your full name.');
    hasError = true;
  }
  if (!email) {
    setFieldError('signup-email', 'signup-email-error', 'Enter your email.');
    hasError = true;
  } else if (!isValidEmail(email)) {
    setFieldError('signup-email', 'signup-email-error', 'Enter a valid email address.');
    hasError = true;
  }
  if (!password) {
    setFieldError('signup-password', 'signup-password-error', 'Create a password.');
    hasError = true;
  } else if (password.length < 8) {
    setFieldError('signup-password', 'signup-password-error', 'Password must be at least 8 characters.');
    hasError = true;
  }
  if (hasError) return;

  setLoading('signup-submit', true);

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { name }
    }
  });

  setLoading('signup-submit', false);

  if (error) {
    setFormMessage('signup-message', error.message || 'Could not create account. Try again.', 'error');
    return;
  }

  setFormMessage(
    'signup-message',
    'Account created. An administrator needs to approve your account before you can log in.',
    'success'
  );
  signupForm.reset();
});
