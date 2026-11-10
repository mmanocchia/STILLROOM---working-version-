import { apiRequest, getShelves, uploadFile } from './api.js';

// Account Settings, Security, Recovery and Deletion.
// Passwords and verification codes are read from the DOM on submit only and
// cleared immediately; they never enter module state, storage, logs or the API.

export const RECEIPT_KEY = 'stillroom.deletionReceipt';
export const SETTINGS_ROUTES = ['/settings'];
export const PUBLIC_SETTINGS_ROUTES = ['/recover', '/deletion-status'];
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,31}$/;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const RESEND_SECONDS = 60;
const POLL_MS = 5000;

export function generateReceipt(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function isReceipt(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
export function normalizeUsername(value = '') { return String(value).trim().replace(/^@/, '').toLowerCase(); }
export function usernameProblem(value) {
  const name = normalizeUsername(value);
  if (!name) return 'Choose a username.';
  if (name.length > 32) return 'Usernames are 32 characters or fewer.';
  if (!USERNAME_PATTERN.test(name)) return 'Use letters, numbers, underscores, dots or hyphens; start with a letter or number.';
  return '';
}
export function isSixDigitCode(value) { return /^\d{6}$/.test(String(value || '').trim()); }
export function deletionReady({ typed, permanent, cascade, role }) {
  return typed === 'DELETE' && permanent === true && (role !== 'Artist' || cascade === true);
}
export function deletionBody({ role, cascade, receipt }) {
  return { confirmation: 'DELETE', artistCascadeConfirmed: role === 'Artist' && cascade === true, receipt };
}
export function profileBody(draft) {
  return {
    name: String(draft.name || '').trim(),
    username: String(draft.username || '').trim().replace(/^@/, '').trim(),
    biography: String(draft.biography || '').trim(),
    profileImageAssetId: draft.profileImageAssetId || null,
  };
}
export function settingsRouteAccess(route, signedIn) {
  if (PUBLIC_SETTINGS_ROUTES.includes(route)) return 'public';
  if (SETTINGS_ROUTES.includes(route)) return signedIn ? 'allowed' : 'login';
  return 'none';
}

export function createSettings(ctx) {
  const { escapeHTML: esc, icon, hrefFor } = ctx;
  const loadSecurity = ctx.loadSecurity || (() => import('./clerkSecurity.js'));
  let security = null;
  let securityLoad = null;
  let securityUnavailable = '';
  let emailResource = null; // in-memory only

  const fresh = () => ({
    loading: false, error: '', data: null, token: 0,
    draft: null, fieldErrors: {}, saving: false, saveError: '', saveNotice: '',
    usernameCheck: { value: '', state: 'idle', message: '' }, usernameTimer: null,
    photoUploading: false, photoError: '', photoPreview: '',
    login: null, loginLoading: false, loginError: '',
    reverify: null, reverifiedAt: 0,
    emailStep: 'idle', emailDraft: '', emailBusy: false, emailError: '', emailNotice: '',
    passwordOpen: false, passwordBusy: false, passwordError: '', passwordNotice: '',
    shelves: [], shelfPage: 0, shelfHasMore: false, shelfLoading: false, shelfError: '', shelfLoaded: false,
    shelfPending: {}, shelfErrors: {},
    deleteTyped: '', deletePermanent: false, deleteCascade: false, deleteBusy: false, deleteError: '', deleteNeedsVerify: false,
  });
  let s = fresh();
  const recover = { step: 'request', email: '', busy: false, error: '', notice: '', cooldownUntil: 0, timer: null, done: false };
  const status = { data: null, loading: false, error: '', missing: false, retrying: false, timer: null, token: 0 };
  let homeNotice = '';

  const route = () => ctx.getRoute();
  const guard = () => ({ gen: ctx.getAuthGeneration(), account: ctx.activeAccount()?.id || null, route: route(), token: s.token });
  const live = (g) => g.gen === ctx.getAuthGeneration() && g.account === (ctx.activeAccount()?.id || null) && g.route === route() && g.token === s.token;
  const securityMessage = (error, options) => {
    try { return security?.securityError ? security.securityError(error, options) : 'That step could not be completed. Please try again.'; } catch { return 'That step could not be completed. Please try again.'; }
  };

  async function ensureSecurity() {
    if (security) return security;
    if (!securityLoad) {
      securityLoad = loadSecurity().then((mod) => { security = mod; return mod; }).catch(() => {
        securityUnavailable = 'Secure account controls are unavailable right now. Nothing has been changed.';
        securityLoad = null;
        throw new Error(securityUnavailable);
      });
    }
    return securityLoad;
  }

  function reset() {
    window.clearTimeout(s.usernameTimer);
    emailResource = null;
    s = fresh();
    s.token += 1;
  }

  // ---------- data ----------
  async function loadSettings() {
    if (s.loading || !ctx.activeAccount()) return;
    s.loading = true; s.error = '';
    const g = guard();
    ctx.render();
    try {
      const data = await apiRequest('/account/settings');
      if (!live(g)) return;
      applyEnvelope(data, true);
    } catch (error) {
      if (!live(g)) return;
      s.error = error.message || 'Your settings could not load.';
    } finally {
      if (live(g)) { s.loading = false; ctx.render(); }
    }
    void loadLogin();
    void loadShelves(0);
  }
  function applyEnvelope(data, resetDraft) {
    s.data = data;
    if (resetDraft || !s.draft) {
      const p = data.profile || {};
      s.draft = { name: p.name || '', username: p.username || '', biography: p.biography || '',
        profileImage: p.profileImage || '', profileImageAssetId: p.profileImageAssetId || null };
      s.usernameCheck = { value: normalizeUsername(p.username), state: 'current', message: '' };
    }
  }
  async function loadLogin() {
    const g = guard();
    s.loginLoading = true; s.loginError = '';
    try {
      const mod = await ensureSecurity();
      const info = await mod.readLoginInfo();
      if (!live(g)) return;
      s.login = { email: info?.email || '', passwordEnabled: Boolean(info?.passwordEnabled) };
    } catch (error) {
      if (!live(g)) return;
      s.loginError = securityUnavailable || securityMessage(error);
    } finally {
      if (live(g)) { s.loginLoading = false; ctx.render(); }
    }
  }
  async function loadShelves(page) {
    const account = ctx.activeAccount();
    if (!account) return;
    const g = guard();
    s.shelfLoading = true; s.shelfError = '';
    ctx.render();
    try {
      const data = await getShelves({ ownerId: account.id, page });
      if (!live(g)) return;
      const list = (data?.shelves || data?.items || []).filter((shelf) => !shelf.ownerId || shelf.ownerId === account.id);
      s.shelves = list; s.shelfPage = page;
      s.shelfHasMore = Boolean(data?.hasMore ?? data?.pagination?.hasMore ?? data?.shelfPagination?.hasMore);
      s.shelfLoaded = true;
    } catch (error) {
      if (!live(g)) return;
      s.shelfError = error.message || 'Your Shelves could not load.';
    } finally {
      if (live(g)) { s.shelfLoading = false; ctx.render(); }
    }
  }

  // ---------- profile ----------
  function queueUsernameCheck(value) {
    window.clearTimeout(s.usernameTimer);
    const name = normalizeUsername(value);
    const problem = usernameProblem(name);
    if (name === normalizeUsername(s.data?.profile?.username)) s.usernameCheck = { value: name, state: 'current', message: 'This is your current username.' };
    else if (problem) s.usernameCheck = { value: name, state: 'invalid', message: problem };
    else {
      s.usernameCheck = { value: name, state: 'checking', message: 'Checking availability…' };
      const g = guard();
      s.usernameTimer = window.setTimeout(async () => {
        try {
          const result = await apiRequest(`/account/username?username=${encodeURIComponent(name)}`);
          if (!live(g) || normalizeUsername(s.draft?.username) !== name) return;
          s.usernameCheck = !result?.valid ? { value: name, state: 'invalid', message: 'That username format is not allowed.' }
            : result.available ? { value: name, state: 'available', message: `@${name} is available.` }
              : { value: name, state: 'taken', message: `@${name} is already taken.` };
        } catch (error) {
          if (!live(g)) return;
          s.usernameCheck = { value: name, state: 'error', message: error.message || 'Availability could not be checked.' };
        }
        paintUsernameStatus();
      }, 420);
    }
    paintUsernameStatus();
  }
  function paintUsernameStatus() {
    const node = document.querySelector('[data-settings-username-status]');
    if (node) { node.outerHTML = usernameStatusHTML(); }
    const save = document.querySelector('[data-settings-profile-save]');
    if (save) save.disabled = profileSaveBlocked();
  }
  function usernameStatusHTML() {
    const c = s.usernameCheck;
    const tone = ['available', 'current'].includes(c.state) ? 'ok' : ['taken', 'invalid', 'error'].includes(c.state) ? 'bad' : 'wait';
    return `<p class="settings-username-status settings-tone-${tone}" data-settings-username-status data-testid="text-username-status" role="status" aria-live="polite">${esc(c.message || '')}</p>`;
  }
  function profileSaveBlocked() {
    return s.saving || s.photoUploading || ['taken', 'invalid', 'checking'].includes(s.usernameCheck.state);
  }
  async function selectPhoto(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !s.draft) return;
    if (!IMAGE_TYPES.includes(file.type)) { s.photoError = 'Choose a JPG, PNG or WebP image.'; ctx.render(); return; }
    if (file.size > 4 * 1024 * 1024) { s.photoError = 'Choose an image smaller than 4 MB.'; ctx.render(); return; }
    const g = guard();
    const local = URL.createObjectURL(file);
    s.photoPreview = local; s.photoUploading = true; s.photoError = '';
    ctx.render();
    try {
      const uploaded = await uploadFile(file, 'profile');
      if (!live(g)) return;
      s.draft = { ...s.draft, profileImage: uploaded.mediaUrl || '', profileImageAssetId: uploaded.assetId };
    } catch (error) {
      if (!live(g)) return;
      s.photoError = error.message || 'The photograph could not be uploaded.';
    } finally {
      URL.revokeObjectURL(local);
      if (live(g)) { s.photoPreview = ''; s.photoUploading = false; ctx.render(); }
    }
  }
  async function saveProfile() {
    if (!s.draft || profileSaveBlocked()) return;
    const body = profileBody(s.draft);
    const errors = {};
    if (!body.name) errors.name = 'Add a display name.';
    if (body.name.length > 80) errors.name = 'Display names are 80 characters or fewer.';
    const problem = usernameProblem(body.username);
    if (problem) errors.username = problem;
    const biographyLimit = ctx.activeAccount()?.role === 'Artist' ? 2000 : 1000;
    if (body.biography.length > biographyLimit) errors.biography = `Biographies are ${biographyLimit.toLocaleString()} characters or fewer.`;
    s.fieldErrors = errors; s.saveError = ''; s.saveNotice = '';
    if (Object.keys(errors).length) { ctx.render(); return; }
    const g = guard();
    s.saving = true; ctx.render();
    try {
      const data = await apiRequest('/account/settings', { method: 'PATCH', body });
      if (!live(g)) return;
      applyEnvelope(data, true);
      s.saveNotice = 'Account information saved. Your sign-in details are unchanged.';
      void ctx.refreshContent();
    } catch (error) {
      if (!live(g)) return;
      s.saveError = error.message || 'Your changes could not be saved.';
      if (error.status === 409) s.fieldErrors = { username: s.saveError };
    } finally {
      if (live(g)) { s.saving = false; ctx.render(); }
    }
  }

  // ---------- reverification ----------
  const recentlyVerified = () => Date.now() - s.reverifiedAt < 4.5 * 60 * 1000;
  async function startReverify(purpose) {
    const g = guard();
    s.reverify = { purpose, busy: true, error: '', strategy: null, factor: null };
    ctx.render();
    try {
      const mod = await ensureSecurity();
      const result = await mod.beginReverification();
      if (!live(g) || !s.reverify) return;
      s.reverify = { ...s.reverify, busy: false, strategy: result?.strategy || 'signin', factor: result?.factor || null };
    } catch (error) {
      if (!live(g) || !s.reverify) return;
      s.reverify = { ...s.reverify, busy: false, error: securityUnavailable || securityMessage(error) };
    }
    ctx.render();
  }
  async function finishReverify(form) {
    const field = form.querySelector('[name="reverifySecret"]');
    const value = field?.value || '';
    if (field) field.value = '';
    const r = s.reverify;
    if (!r || r.busy) return;
    if (r.strategy === 'email_code' && !isSixDigitCode(value)) { s.reverify = { ...r, error: 'Enter the 6-digit code from your email.' }; ctx.render(); return; }
    if (r.strategy === 'password' && !value) { s.reverify = { ...r, error: 'Enter your current password.' }; ctx.render(); return; }
    const g = guard();
    s.reverify = { ...r, busy: true, error: '' }; ctx.render();
    try {
      await security.finishReverification(r.strategy, value.trim ? (r.strategy === 'email_code' ? value.trim() : value) : value);
      if (!live(g)) return;
      s.reverifiedAt = Date.now();
      const purpose = r.purpose;
      s.reverify = null;
      if (purpose === 'email') s.emailStep = 'enter';
      if (purpose === 'delete') { s.deleteNeedsVerify = false; s.deleteError = ''; }
    } catch (error) {
      if (!live(g) || !s.reverify) return;
      s.reverify = { ...s.reverify, busy: false, error: securityMessage(error) };
    }
    ctx.render();
  }

  // ---------- email ----------
  async function beginEmail(form) {
    const email = form.querySelector('[name="newEmail"]')?.value.trim() || '';
    s.emailDraft = email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { s.emailError = 'Enter a valid email address.'; ctx.render(); return; }
    if (email.toLowerCase() === (s.login?.email || '').toLowerCase()) { s.emailError = 'That is already your sign-in email.'; ctx.render(); return; }
    const g = guard();
    s.emailBusy = true; s.emailError = ''; ctx.render();
    try {
      const resource = await security.beginEmailChange(email);
      if (!live(g)) return;
      emailResource = resource;
      s.emailStep = 'code';
    } catch (error) {
      if (!live(g)) return;
      s.emailError = securityMessage(error);
    } finally {
      if (live(g)) { s.emailBusy = false; ctx.render(); }
    }
  }
  async function verifyEmail(form) {
    const field = form.querySelector('[name="emailCode"]');
    const code = (field?.value || '').trim();
    if (field) field.value = '';
    if (!isSixDigitCode(code)) { s.emailError = 'Enter the 6-digit code sent to the new address.'; ctx.render(); return; }
    if (!emailResource) { s.emailError = 'Start the email change again.'; s.emailStep = 'enter'; ctx.render(); return; }
    const g = guard();
    s.emailBusy = true; s.emailError = ''; ctx.render();
    try {
      const verified = await security.verifyEmailChange(emailResource, code);
      if (!live(g)) return;
      if (!verified) throw new Error('not verified');
      emailResource = null;
      s.emailStep = 'idle'; s.emailDraft = '';
      const info = await security.readLoginInfo();
      if (!live(g)) return;
      s.login = { email: info?.email || '', passwordEnabled: Boolean(info?.passwordEnabled) };
      s.emailNotice = 'Verified. This address is now your sign-in email.';
    } catch (error) {
      if (!live(g)) return;
      s.emailError = securityMessage(error);
    } finally {
      if (live(g)) { s.emailBusy = false; ctx.render(); }
    }
  }

  // ---------- password ----------
  async function changePassword(form) {
    const read = (name) => { const f = form.querySelector(`[name="${name}"]`); const v = f?.value || ''; if (f) f.value = ''; return v; };
    const current = read('currentPassword'); const next = read('newPassword'); const confirm = read('confirmPassword');
    s.passwordNotice = '';
    if (!current || !next) { s.passwordError = 'Enter your current and new password.'; ctx.render(); return; }
    if (next.length < 8) { s.passwordError = 'New passwords need at least 8 characters.'; ctx.render(); return; }
    if (next !== confirm) { s.passwordError = 'The new passwords do not match.'; ctx.render(); return; }
    const g = guard();
    s.passwordBusy = true; s.passwordError = ''; ctx.render();
    try {
      const mod = await ensureSecurity();
      await mod.changePassword(current, next);
      if (!live(g)) return;
      s.passwordOpen = false;
      s.passwordNotice = 'Password changed.';
    } catch (error) {
      if (!live(g)) return;
      s.passwordError = securityUnavailable || securityMessage(error);
    } finally {
      if (live(g)) { s.passwordBusy = false; ctx.render(); }
    }
  }

  // ---------- shelves ----------
  async function setShelfVisibility(shelfId, visibility) {
    const shelf = s.shelves.find((entry) => entry.id === shelfId);
    if (!shelf || s.shelfPending[shelfId] || shelf.visibility === visibility) return;
    const g = guard();
    s.shelfPending = { ...s.shelfPending, [shelfId]: visibility };
    s.shelfErrors = { ...s.shelfErrors, [shelfId]: '' };
    ctx.render();
    try {
      await ctx.persistAction('shelf.save', { shelfId, title: shelf.title, description: shelf.description || '', visibility });
      if (!live(g)) return;
      const next = { ...s.shelfPending }; delete next[shelfId]; s.shelfPending = next;
      await loadShelves(s.shelfPage);
    } catch (error) {
      if (!live(g)) return;
      const next = { ...s.shelfPending }; delete next[shelfId]; s.shelfPending = next;
      s.shelfErrors = { ...s.shelfErrors, [shelfId]: error.message || 'Visibility could not be changed.' };
      ctx.render();
    }
  }

  // ---------- deletion ----------
  async function submitDeletion() {
    const account = ctx.activeAccount();
    if (!account || s.deleteBusy) return;
    if (!deletionReady({ typed: s.deleteTyped, permanent: s.deletePermanent, cascade: s.deleteCascade, role: account.role })) {
      s.deleteError = 'Type DELETE and tick every confirmation to continue.'; ctx.render(); return;
    }
    let receipt = window.sessionStorage.getItem(RECEIPT_KEY);
    if (!isReceipt(receipt)) { receipt = generateReceipt(); window.sessionStorage.setItem(RECEIPT_KEY, receipt); }
    const g = guard();
    s.deleteBusy = true; s.deleteError = ''; ctx.render();
    try {
      const result = await apiRequest('/account/deletion', { method: 'POST', body: deletionBody({ role: account.role, cascade: s.deleteCascade, receipt }) });
      if (!live(g)) return;
      await deletionStarted(result);
    } catch (error) {
      if (!live(g)) return;
      if (error.status === 403) {
        s.deleteNeedsVerify = true;
        s.deleteError = 'Stillroom needs you to verify your identity in the last 5 minutes before deleting. Your confirmation is kept.';
        window.sessionStorage.removeItem(RECEIPT_KEY);
      } else if (!error.status) {
        // Network failure: never assume success. Ask the server what happened.
        try {
          const known = await apiRequest('/account/deletion/status', { method: 'POST', body: { receipt } });
          if (!live(g)) return;
          await deletionStarted(known);
          return;
        } catch (statusError) {
          if (!live(g)) return;
          if (statusError.status === 404) window.sessionStorage.removeItem(RECEIPT_KEY);
          s.deleteError = statusError.status === 404
            ? 'The deletion request did not reach Stillroom. Nothing was deleted. You can try again.'
            : 'Stillroom could not confirm whether deletion started. Check the deletion status before trying again.';
        }
      } else {
        window.sessionStorage.removeItem(RECEIPT_KEY);
        s.deleteError = error.message || 'Deletion could not start.';
      }
    } finally {
      if (live(g)) { s.deleteBusy = false; ctx.render(); }
    }
  }
  async function deletionStarted(result) {
    status.data = result || null; status.missing = false; status.error = '';
    reset();
    await ctx.signOutForDeletion();
  }

  // ---------- deletion status ----------
  function stopPolling() { window.clearTimeout(status.timer); status.timer = null; }
  async function checkStatus({ quiet = false } = {}) {
    const receipt = window.sessionStorage.getItem(RECEIPT_KEY);
    stopPolling();
    if (!isReceipt(receipt)) { status.missing = true; ctx.render(); return; }
    const token = ++status.token;
    if (!quiet) { status.loading = true; ctx.render(); }
    try {
      const data = await apiRequest('/account/deletion/status', { method: 'POST', body: { receipt } });
      if (token !== status.token || route() !== '/deletion-status') return;
      status.data = data; status.error = ''; status.missing = false;
      if (data?.status === 'complete') {
        window.sessionStorage.removeItem(RECEIPT_KEY);
        homeNotice = data.message || 'Your Stillroom account and its active data have been deleted.';
        status.loading = false;
        ctx.navigate('/home');
        return;
      }
    } catch (error) {
      if (token !== status.token || route() !== '/deletion-status') return;
      if (error.status === 404) { status.missing = true; status.data = null; }
      else status.error = error.message || 'The deletion status could not be checked.';
    }
    status.loading = false;
    ctx.render();
    schedulePoll();
  }
  function schedulePoll() {
    stopPolling();
    if (route() === '/deletion-status' && status.data?.status === 'pending' && document.visibilityState !== 'hidden') {
      status.timer = window.setTimeout(() => checkStatus({ quiet: true }), POLL_MS);
    }
  }
  async function retryDeletion() {
    const receipt = window.sessionStorage.getItem(RECEIPT_KEY);
    if (!isReceipt(receipt) || status.retrying) return;
    const token = ++status.token;
    status.retrying = true; status.error = ''; ctx.render();
    try {
      const data = await apiRequest('/account/deletion/retry', { method: 'POST', body: { receipt } });
      if (token !== status.token || route() !== '/deletion-status') return;
      status.data = data;
    } catch (error) {
      if (token !== status.token || route() !== '/deletion-status') return;
      status.error = error.message || 'Cleanup could not be retried right now.';
    }
    status.retrying = false;
    ctx.render();
    schedulePoll();
  }

  // ---------- recovery ----------
  function cooldownLeft() { return Math.max(0, Math.ceil((recover.cooldownUntil - Date.now()) / 1000)); }
  function tickCooldown() {
    window.clearTimeout(recover.timer);
    const node = document.querySelector('[data-recover-resend]');
    const left = cooldownLeft();
    if (node) { node.disabled = left > 0 || recover.busy; node.textContent = left > 0 ? `Resend code in ${left}s` : 'Resend code'; }
    if (left > 0 && route() === '/recover') recover.timer = window.setTimeout(tickCooldown, 1000);
  }
  async function sendRecovery(email) {
    if (cooldownLeft() > 0 || recover.busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { recover.error = 'Enter a valid email address.'; ctx.render(); return; }
    recover.busy = true; recover.error = ''; recover.email = email; ctx.render();
    try {
      const mod = await ensureSecurity();
      await mod.sendRecovery(email);
      recover.step = 'code';
      recover.notice = 'If an account uses that address, a 6-digit code is on its way. It may take a minute to arrive.';
      recover.cooldownUntil = Date.now() + RESEND_SECONDS * 1000;
    } catch (error) {
      recover.error = securityUnavailable || securityMessage(error, { recovery: true });
    } finally {
      recover.busy = false; ctx.render(); tickCooldown();
    }
  }
  async function completeRecovery(form) {
    const read = (name) => { const f = form.querySelector(`[name="${name}"]`); const v = f?.value || ''; if (f) f.value = ''; return v; };
    const code = read('recoveryCode').trim(); const next = read('recoveryPassword'); const confirm = read('recoveryConfirm');
    if (!isSixDigitCode(code)) { recover.error = 'Enter the 6-digit code from the email.'; ctx.render(); return; }
    if (next.length < 8) { recover.error = 'New passwords need at least 8 characters.'; ctx.render(); return; }
    if (next !== confirm) { recover.error = 'The new passwords do not match.'; ctx.render(); return; }
    recover.busy = true; recover.error = ''; ctx.render();
    try {
      await security.completeRecovery(code, next);
      recover.done = true; recover.step = 'done'; recover.notice = '';
    } catch (error) {
      recover.error = securityMessage(error, { recovery: true });
    } finally {
      recover.busy = false; ctx.render(); tickCooldown();
    }
  }

  // ---------- rendering ----------
  const busyLabel = (busy, idle, active) => (busy ? `<span class="loading-dot" aria-hidden="true"></span>${active}` : idle);
  const errorHTML = (message, id = '') => (message ? `<p class="inline-error settings-error" role="alert" ${id ? `id="${id}"` : ''}>${esc(message)}</p>` : '');
  const noticeHTML = (message, testid) => (message ? `<p class="settings-notice" role="status" data-testid="${testid}">${icon('check', 14)}${esc(message)}</p>` : '');

  function renderReverify(purpose) {
    const r = s.reverify;
    if (!r || r.purpose !== purpose) return '';
    if (r.busy && !r.strategy) return `<div class="settings-verify" role="status" aria-busy="true"><span class="settings-skeleton"></span><span class="settings-skeleton short"></span></div>`;
    let body = '';
    if (r.strategy === 'password') {
      body = `<label class="field-label" for="reverify-secret">Current password</label>
        <input class="field-input" id="reverify-secret" name="reverifySecret" type="password" autocomplete="current-password" data-testid="input-reverify-password" />`;
    } else if (r.strategy === 'email_code') {
      const where = r.factor?.safeIdentifier ? ` sent to ${esc(r.factor.safeIdentifier)}` : ' sent to your sign-in email';
      body = `<label class="field-label" for="reverify-secret">6-digit code${where}</label>
        <input class="field-input settings-code" id="reverify-secret" name="reverifySecret" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" data-testid="input-reverify-code" />`;
    }
    const signin = r.strategy === 'signin' || !['password', 'email_code'].includes(r.strategy || '');
    return `<form class="settings-verify" data-form="settings-reverify" data-testid="form-reverify">
      <p class="eyebrow">Verify identity</p>
      <p class="settings-copy">${signin
        ? 'Your sign-in method can’t be confirmed here. Sign out and sign in again, then return to Settings within 5 minutes.'
        : 'Confirm it’s you before changing sensitive details. Nothing is stored by Stillroom.'}</p>
      ${r.error ? errorHTML(r.error) : ''}
      ${body}
      <div class="settings-actions">
        ${signin
          ? `<button class="primary-button" type="button" data-action="settings-fresh-login" data-testid="button-fresh-login">Sign out and sign in again</button>`
          : `<button class="primary-button" type="submit" ${r.busy ? 'disabled' : ''} data-testid="button-verify-identity">${busyLabel(r.busy, 'Verify', 'Verifying…')}</button>`}
        <button class="text-button" type="button" data-action="settings-cancel-reverify" data-testid="button-cancel-reverify">Cancel</button>
      </div>
    </form>`;
  }

  function renderAccountInfo() {
    const d = s.draft;
    const photo = s.photoPreview || d.profileImage;
    const initial = esc((d.name || d.username || '?').trim().charAt(0).toUpperCase());
    const fe = s.fieldErrors;
    const field = (key) => (fe[key] ? `aria-invalid="true" aria-describedby="settings-${key}-error"` : '');
    return `<section class="settings-section" id="settings-account" aria-labelledby="settings-account-title">
      <header class="settings-section-head"><span class="settings-index">01</span><div><h2 id="settings-account-title" class="settings-heading">Account information</h2><p class="settings-copy">How you appear across the Feed, comments, Artist Boards and Shelves. Your account ID never changes.</p></div></header>
      <form class="settings-card" data-form="settings-profile" novalidate data-testid="form-settings-profile">
        <div class="settings-photo">
          ${photo ? `<img class="settings-photo-img" src="${esc(photo)}" alt="Profile photograph" data-testid="img-settings-photo" />` : `<span class="settings-photo-img settings-photo-empty" data-testid="img-settings-photo">${initial}</span>`}
          <div class="settings-photo-copy">
            <p class="preview-title">Profile photograph</p>
            <p class="field-hint">JPG, PNG or WebP, up to 4 MB. Shown publicly.</p>
            <div class="settings-actions tight">
              <label class="quiet-button settings-file ${s.photoUploading || s.saving ? 'is-disabled' : ''}">${icon('image', 14)} ${s.photoUploading ? 'Uploading…' : photo ? 'Replace' : 'Upload'}
                <input type="file" accept="image/png,image/jpeg,image/webp" data-settings-photo ${s.photoUploading || s.saving ? 'disabled' : ''} data-testid="input-settings-photo" /></label>
              ${d.profileImageAssetId || d.profileImage ? `<button class="text-button" type="button" data-action="settings-remove-photo" ${s.photoUploading || s.saving ? 'disabled' : ''} data-testid="button-remove-photo">Remove</button>` : ''}
            </div>
            ${errorHTML(s.photoError)}
          </div>
        </div>
        <div class="settings-grid">
          <div><label class="field-label" for="settings-name">Display name</label>
            <input class="field-input" id="settings-name" name="settingsName" maxlength="80" value="${esc(d.name)}" ${field('name')} data-testid="input-settings-name" />
            ${errorHTML(fe.name, 'settings-name-error')}</div>
          <div><label class="field-label" for="settings-username">Username</label>
            <div class="settings-handle"><span aria-hidden="true">@</span><input class="field-input" id="settings-username" name="settingsUsername" maxlength="31" autocomplete="off" spellcheck="false" value="${esc(d.username)}" ${field('username')} data-testid="input-settings-username" /></div>
            ${fe.username ? errorHTML(fe.username, 'settings-username-error') : usernameStatusHTML()}
            <p class="field-hint">Changing your handle doesn’t change how you sign in.</p></div>
        </div>
        <label class="field-label" for="settings-bio">Biography <span class="optional-label">optional</span></label>
        <textarea class="field-input field-textarea" id="settings-bio" name="settingsBiography" maxlength="${ctx.activeAccount()?.role === 'Artist' ? 2000 : 1000}" ${field('biography')} data-testid="input-settings-biography">${esc(d.biography)}</textarea>
        ${errorHTML(fe.biography, 'settings-biography-error')}
        ${errorHTML(s.saveError)}${noticeHTML(s.saveNotice, 'status-settings-saved')}
        <div class="settings-actions">
          <button class="primary-button" type="submit" data-settings-profile-save ${profileSaveBlocked() ? 'disabled' : ''} data-testid="button-save-settings">${busyLabel(s.saving, 'Save changes', 'Saving…')}</button>
          <button class="text-button" type="button" data-action="settings-discard" ${s.saving ? 'disabled' : ''} data-testid="button-discard-settings">Discard</button>
        </div>
      </form>
    </section>`;
  }

  function renderSecurity() {
    let emailBlock;
    if (s.loginLoading && !s.login) emailBlock = `<div role="status" aria-busy="true"><span class="settings-skeleton"></span><span class="settings-skeleton short"></span></div>`;
    else if (!s.login) emailBlock = `${errorHTML(s.loginError || securityUnavailable || 'Sign-in details are unavailable.')}<button class="quiet-button" type="button" data-action="settings-retry-login" data-testid="button-retry-login">Try again</button>`;
    else {
      const verifyOpen = s.reverify?.purpose === 'email';
      let flow = '';
      if (s.emailStep === 'enter') {
        flow = `<form class="settings-subform" data-form="settings-email" novalidate data-testid="form-email-change">
          <label class="field-label" for="settings-new-email">New email address</label>
          <input class="field-input" id="settings-new-email" name="newEmail" type="email" autocomplete="email" value="${esc(s.emailDraft)}" data-testid="input-new-email" />
          <p class="field-hint">We’ll send a code to the new address. Your current email stays in place until it’s verified.</p>
          ${errorHTML(s.emailError)}
          <div class="settings-actions"><button class="primary-button" type="submit" ${s.emailBusy ? 'disabled' : ''} data-testid="button-send-email-code">${busyLabel(s.emailBusy, 'Send code', 'Sending…')}</button>
          <button class="text-button" type="button" data-action="settings-cancel-email" data-testid="button-cancel-email">Cancel</button></div></form>`;
      } else if (s.emailStep === 'code') {
        flow = `<form class="settings-subform" data-form="settings-email-code" novalidate data-testid="form-email-verify">
          <label class="field-label" for="settings-email-code">6-digit code sent to ${esc(s.emailDraft)}</label>
          <input class="field-input settings-code" id="settings-email-code" name="emailCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-testid="input-email-code" />
          ${errorHTML(s.emailError)}
          <div class="settings-actions"><button class="primary-button" type="submit" ${s.emailBusy ? 'disabled' : ''} data-testid="button-verify-email">${busyLabel(s.emailBusy, 'Verify email', 'Verifying…')}</button>
          <button class="text-button" type="button" data-action="settings-cancel-email" data-testid="button-cancel-email">Cancel</button></div></form>`;
      }
      emailBlock = `<dl class="settings-facts">
          <div><dt>Sign-in email</dt><dd data-testid="text-login-email">${esc(s.login.email || 'No email on file')}</dd></div>
          <div><dt>Password</dt><dd data-testid="text-password-status">${s.login.passwordEnabled ? 'Set' : 'Not used — you sign in with a connected account or email code'}</dd></div>
        </dl>
        ${noticeHTML(s.emailNotice, 'status-email-changed')}
        ${s.emailStep === 'idle' && !verifyOpen ? `<div class="settings-actions"><button class="quiet-button" type="button" data-action="settings-change-email" data-testid="button-change-email">${icon('edit', 14)} Change email</button></div>` : ''}
        ${renderReverify('email')}${flow}`;
    }
    const pw = s.login?.passwordEnabled ? `<div class="settings-block">
        <h3 class="settings-subheading">Password</h3>
        ${noticeHTML(s.passwordNotice, 'status-password-changed')}
        ${s.passwordOpen ? `<form class="settings-subform" data-form="settings-password" novalidate data-testid="form-password">
          <label class="field-label" for="pw-current">Current password</label><input class="field-input" id="pw-current" name="currentPassword" type="password" autocomplete="current-password" data-testid="input-current-password" />
          <label class="field-label" for="pw-new">New password</label><input class="field-input" id="pw-new" name="newPassword" type="password" autocomplete="new-password" minlength="8" data-testid="input-new-password" />
          <label class="field-label" for="pw-confirm">Confirm new password</label><input class="field-input" id="pw-confirm" name="confirmPassword" type="password" autocomplete="new-password" data-testid="input-confirm-password" />
          ${errorHTML(s.passwordError)}
          <div class="settings-actions"><button class="primary-button" type="submit" ${s.passwordBusy ? 'disabled' : ''} data-testid="button-save-password">${busyLabel(s.passwordBusy, 'Change password', 'Updating…')}</button>
          <button class="text-button" type="button" data-action="settings-cancel-password" data-testid="button-cancel-password">Cancel</button></div>
        </form>` : `<div class="settings-actions"><button class="quiet-button" type="button" data-action="settings-open-password" data-testid="button-change-password">Change password</button>
          <a class="text-link" href="${hrefFor('/recover')}" data-route="/recover" data-testid="link-forgot-password">Forgot password?</a></div>`}
      </div>` : '';
    return `<section class="settings-section" id="settings-security" aria-labelledby="settings-security-title">
      <header class="settings-section-head"><span class="settings-index">02</span><div><h2 id="settings-security-title" class="settings-heading">Login &amp; security</h2><p class="settings-copy">Managed by our sign-in provider. Stillroom never sees or stores your password, and your email is never sent to Stillroom’s servers from this page.</p></div></header>
      <div class="settings-card">${emailBlock}${pw}</div>
    </section>`;
  }

  function renderPrivacy() {
    const privacy = s.data?.privacy || {};
    const fields = Array.isArray(privacy.publicFields) ? privacy.publicFields : [];
    const shelfRows = s.shelves.map((shelf) => {
      const pending = s.shelfPending[shelf.id];
      const value = pending || shelf.visibility;
      return `<li class="settings-shelf" data-testid="row-settings-shelf-${esc(shelf.id)}">
        <div class="settings-shelf-copy"><a class="settings-shelf-title" href="${hrefFor(`/shelves/${encodeURIComponent(shelf.id)}`)}" data-route="/shelves/${esc(encodeURIComponent(shelf.id))}">${esc(shelf.title)}</a>
          ${s.shelfErrors[shelf.id] ? errorHTML(s.shelfErrors[shelf.id]) : pending ? '<span class="field-hint" role="status">Saving…</span>' : ''}</div>
        <label class="sr-only" for="shelf-vis-${esc(shelf.id)}">Visibility for ${esc(shelf.title)}</label>
        <select class="settings-select" id="shelf-vis-${esc(shelf.id)}" data-settings-shelf="${esc(shelf.id)}" ${pending ? 'disabled' : ''} data-testid="select-shelf-visibility-${esc(shelf.id)}">
          <option value="private" ${value === 'private' ? 'selected' : ''}>Private</option>
          <option value="public" ${value === 'public' ? 'selected' : ''}>Public</option>
        </select></li>`;
    }).join('');
    let shelves;
    if (s.shelfLoading && !s.shelfLoaded) shelves = `<div role="status" aria-busy="true"><span class="settings-skeleton"></span><span class="settings-skeleton"></span></div>`;
    else if (s.shelfError) shelves = `${errorHTML(s.shelfError)}<button class="quiet-button" type="button" data-action="settings-shelf-page" data-page="${s.shelfPage}">Try again</button>`;
    else if (!s.shelves.length) shelves = `<p class="settings-empty">${s.shelfPage ? 'No more Shelves.' : 'You haven’t made any Shelves yet.'} <a class="text-link" href="${hrefFor('/shelves')}" data-route="/shelves">Go to My Space</a></p>`;
    else shelves = `<ul class="settings-shelves">${shelfRows}</ul>`;
    const pager = s.shelfPage || s.shelfHasMore ? `<nav class="settings-actions" aria-label="Shelf pages">
      <button class="quiet-button" type="button" data-action="settings-shelf-page" data-page="${Math.max(0, s.shelfPage - 1)}" ${!s.shelfPage || s.shelfLoading ? 'disabled' : ''}>Previous</button>
      <span class="field-hint" role="status">Page ${s.shelfPage + 1}</span>
      <button class="quiet-button" type="button" data-action="settings-shelf-page" data-page="${s.shelfPage + 1}" ${!s.shelfHasMore || s.shelfLoading ? 'disabled' : ''}>Next</button></nav>` : '';
    return `<section class="settings-section" id="settings-privacy" aria-labelledby="settings-privacy-title">
      <header class="settings-section-head"><span class="settings-index">03</span><div><h2 id="settings-privacy-title" class="settings-heading">Privacy</h2><p class="settings-copy">What other people can see, and what stays with you.</p></div></header>
      <div class="settings-card">
        <h3 class="settings-subheading">Visible to everyone</h3>
        ${fields.length ? `<ul class="settings-chips" data-testid="list-public-fields">${fields.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="settings-empty">No public field list was returned.</p>'}
        <p class="settings-copy">Your username, profile photograph and biography appear on your profile, posts and comments.${ctx.activeAccount()?.role === 'Artist' ? ' Your Artist Board is public.' : ''} Your email address is never shown publicly. Stillroom has no separate contact-information field.</p>
        <h3 class="settings-subheading">Your Shelves</h3>
        ${shelves}${pager}
        <h3 class="settings-subheading">If you delete your account</h3>
        <p class="settings-copy" data-testid="text-deletion-explanation">${esc(privacy.deletionExplanation || '')}</p>
        <a class="text-link" href="#settings-delete" data-action="settings-jump-delete">Go to Delete account ${icon('arrow', 12)}</a>
      </div>
    </section>`;
  }

  function renderDelete() {
    const account = ctx.activeAccount();
    const artist = account?.role === 'Artist';
    const ready = deletionReady({ typed: s.deleteTyped, permanent: s.deletePermanent, cascade: s.deleteCascade, role: account?.role });
    return `<section class="settings-section settings-danger" id="settings-delete" aria-labelledby="settings-delete-title">
      <header class="settings-section-head"><span class="settings-index">04</span><div><h2 id="settings-delete-title" class="settings-heading">Delete account</h2><p class="settings-copy">Permanent. There is no undo and no restore.</p></div></header>
      <form class="settings-card" data-form="settings-delete" novalidate data-testid="form-delete-account">
        <ul class="settings-consequences">
          <li>Your sign-in identity is removed, and every active session ends.</li>
          <li>Your profile, posts, comments, reposts, follows, Shelves and saved posts are removed.</li>
          <li>Your uploaded photographs and videos are deleted from storage.</li>
          ${artist ? '<li class="settings-cascade"><strong>Your Artist Board and Collections are deleted. Fan Posts contributed to your Board, and the comments, reposts and saves on them, will also be permanently removed.</strong></li>' : ''}
        </ul>
        <p class="field-hint">Removal from active systems starts immediately; media cleanup finishes in the background and you can follow its status.</p>
        ${s.deleteNeedsVerify ? (s.reverify?.purpose === 'delete' ? '' : `<div class="settings-actions"><button class="quiet-button" type="button" data-action="settings-verify-delete" data-testid="button-verify-delete">Verify identity</button></div>`) : ''}
        ${renderReverify('delete')}
        <label class="field-label" for="settings-delete-typed">Type DELETE to confirm</label>
        <input class="field-input settings-code" id="settings-delete-typed" name="deleteTyped" autocomplete="off" spellcheck="false" value="${esc(s.deleteTyped)}" data-testid="input-delete-confirm" />
        <label class="settings-check"><input type="checkbox" name="deletePermanent" ${s.deletePermanent ? 'checked' : ''} data-testid="checkbox-delete-permanent" /> <span>I understand this is permanent and cannot be reversed.</span></label>
        ${artist ? `<label class="settings-check"><input type="checkbox" name="deleteCascade" ${s.deleteCascade ? 'checked' : ''} data-testid="checkbox-delete-cascade" /> <span>I understand Fan contributions to my Board, and interactions on them, will be removed.</span></label>` : ''}
        ${errorHTML(s.deleteError)}
        <div class="settings-actions"><button class="danger-button" type="submit" data-settings-delete-submit ${!ready || s.deleteBusy ? 'disabled' : ''} data-testid="button-delete-account">${icon('trash', 14)} ${s.deleteBusy ? 'Deleting…' : 'Delete my account'}</button></div>
      </form>
    </section>`;
  }

  function renderSettings() {
    const account = ctx.activeAccount();
    if (!account) return `<section>${ctx.renderEmpty('Sign in to manage your account.')}</section>`;
    if (!s.data && !s.loading && !s.error) queueMicrotask(loadSettings);
    const intro = `<p class="eyebrow">Your account · ${esc(account.role)}</p><h1 class="page-title">Settings</h1>`;
    if (s.error && !s.data) return `<section class="settings-page">${intro}<div class="error-banner" role="alert">${esc(s.error)} <button class="text-button" type="button" data-action="settings-reload" data-testid="button-reload-settings">Try again</button></div></section>`;
    if (!s.data || !s.draft) return `<section class="settings-page" aria-busy="true">${intro}<div class="settings-layout"><div></div><div>${[1, 2, 3].map(() => '<div class="settings-card"><span class="settings-skeleton"></span><span class="settings-skeleton"></span><span class="settings-skeleton short"></span></div>').join('')}</div></div></section>`;
    const pendingDeletion = s.data.deletion;
    return `<section class="settings-page">${intro}
      <p class="page-subtitle">Your details, sign-in and privacy in one quiet place.</p>
      ${pendingDeletion ? `<div class="error-banner" role="status">${esc(pendingDeletion.message || 'Account deletion is in progress.')} <a class="text-link" href="${hrefFor('/deletion-status')}" data-route="/deletion-status">View status</a></div>` : ''}
      <div class="settings-layout">
        <nav class="settings-toc" aria-label="Settings sections">
          <a href="#settings-account" data-action="settings-jump" data-target="settings-account">Account information</a>
          <a href="#settings-security" data-action="settings-jump" data-target="settings-security">Login &amp; security</a>
          <a href="#settings-privacy" data-action="settings-jump" data-target="settings-privacy">Privacy</a>
          <a href="#settings-delete" data-action="settings-jump" data-target="settings-delete" class="settings-toc-danger">Delete account</a>
        </nav>
        <div class="settings-sections">${renderAccountInfo()}${renderSecurity()}${renderPrivacy()}${renderDelete()}</div>
      </div>
    </section>`;
  }

  function publicFrame(eyebrow, title, copy, card) {
    return `<div class="paper-grain landing-page page-enter">
      ${ctx.header({ right: `<a class="text-button" href="${hrefFor('/login')}" data-route="/login">${icon('back', 14)} Back to sign in</a>` })}
      <main class="registration-layout">
        <section class="registration-intro"><p class="eyebrow">${eyebrow}</p><h1 class="registration-title">${title}</h1><p class="registration-copy">${copy}</p></section>
        <section class="registration-card settings-public-card">${card}</section>
      </main></div>`;
  }

  function renderRecover() {
    if (ctx.activeAccount()) {
      return publicFrame('Account recovery', 'Recover your password.',
        'Keep account recovery separate from your signed-in session.',
        `<h2 class="settings-card-heading">Sign out to continue</h2>
        <p class="settings-help">You’re signed in. Sign out before starting password recovery. Your profile and saved content will remain safe.</p>
        <button type="button" class="primary-button" data-action="recover-signout" data-testid="button-recovery-signout">Sign out and recover password</button>
        <a class="quiet-button" href="${hrefFor('/settings')}" data-route="/settings">Back to Settings</a>`);
    }
    let card;
    if (recover.step === 'done') {
      card = `<p class="eyebrow">Done</p><h2>Password updated.</h2>
        <p class="settings-copy" role="status" data-testid="status-recovery-complete">Sign in with your new password. You have not been signed in automatically.</p>
        <a class="primary-button" href="${hrefFor('/login')}" data-route="/login" data-testid="link-recovery-sign-in">Go to sign in</a>`;
    } else if (recover.step === 'code') {
      const left = cooldownLeft();
      card = `<p class="eyebrow">Step 2 of 2</p><h2>Enter your code</h2>
        ${noticeHTML(recover.notice, 'status-recovery-sent')}
        <form data-form="recover-complete" novalidate data-testid="form-recovery-complete">
          <label class="field-label" for="recovery-code">6-digit code</label>
          <input class="field-input settings-code" id="recovery-code" name="recoveryCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-testid="input-recovery-code" />
          <label class="field-label" for="recovery-password">New password</label>
          <input class="field-input" id="recovery-password" name="recoveryPassword" type="password" autocomplete="new-password" data-testid="input-recovery-password" />
          <label class="field-label" for="recovery-confirm">Confirm new password</label>
          <input class="field-input" id="recovery-confirm" name="recoveryConfirm" type="password" autocomplete="new-password" data-testid="input-recovery-confirm" />
          ${errorHTML(recover.error)}
          <div class="settings-actions"><button class="primary-button" type="submit" ${recover.busy ? 'disabled' : ''} data-testid="button-recovery-complete">${busyLabel(recover.busy, 'Set new password', 'Saving…')}</button>
            <button class="text-button" type="button" data-recover-resend data-action="recover-resend" ${left > 0 || recover.busy ? 'disabled' : ''} data-testid="button-recovery-resend">${left > 0 ? `Resend code in ${left}s` : 'Resend code'}</button>
            <button class="text-button" type="button" data-action="recover-restart" data-testid="button-recovery-restart">Use a different email</button></div>
        </form>`;
    } else {
      card = `<p class="eyebrow">Step 1 of 2</p><h2>Reset your password</h2>
        <form data-form="recover-request" novalidate data-testid="form-recovery-request">
          <label class="field-label" for="recovery-email">Email address</label>
          <input class="field-input" id="recovery-email" name="recoveryEmail" type="email" autocomplete="email" value="${esc(recover.email)}" data-testid="input-recovery-email" />
          ${errorHTML(recover.error)}
          <div class="settings-actions"><button class="primary-button" type="submit" ${recover.busy ? 'disabled' : ''} data-testid="button-recovery-send">${busyLabel(recover.busy, 'Send code', 'Sending…')}</button></div>
        </form>`;
    }
    return publicFrame('Account recovery', 'Back into<br>your <em>Stillroom.</em>', 'We’ll email a short code through our sign-in provider. For your privacy we never say whether an address has an account.', card);
  }

  function renderDeletionStatus() {
    if (!status.data && !status.missing && !status.loading && !status.error) queueMicrotask(() => checkStatus());
    const d = status.data;
    let card;
    if (status.missing) {
      card = `<p class="eyebrow">Deletion status</p><h2>No deletion in this tab</h2><p class="settings-copy" data-testid="status-deletion-missing">This browser tab has no deletion receipt, or Stillroom has no matching request. Receipts only last for this tab session.</p>
        <a class="quiet-button" href="${hrefFor('/home')}" data-route="/home">Go to Feed</a>`;
    } else if (!d) {
      card = status.error
        ? `<p class="eyebrow">Deletion status</p>${errorHTML(status.error)}<button class="quiet-button" type="button" data-action="deletion-status-check" data-testid="button-deletion-check">Check again</button>`
        : `<div role="status" aria-busy="true"><span class="settings-skeleton"></span><span class="settings-skeleton"></span><span class="settings-skeleton short"></span></div>`;
    } else {
      const step = (done, label) => `<li class="${done ? 'is-done' : ''}">${done ? icon('check', 13) : '<span class="loading-dot" aria-hidden="true"></span>'}<span>${label}</span></li>`;
      card = `<p class="eyebrow">Deletion status</p><h2 data-testid="text-deletion-status">${d.status === 'complete' ? 'Deletion complete' : 'Deletion in progress'}</h2>
        <p class="settings-copy" role="status">${esc(d.message || '')}</p>
        <ul class="settings-steps">
          ${step(d.applicationDataRemoved, 'Stillroom account data removed')}
          ${step(d.authenticationRemoved, 'Sign-in identity removed')}
          ${step(!d.pendingMedia, d.pendingMedia ? `Media cleanup pending (${esc(d.pendingMedia)})` : 'Media cleanup finished')}
        </ul>
        ${errorHTML(status.error)}
        <div class="settings-actions">
          <button class="quiet-button" type="button" data-action="deletion-status-check" ${status.loading ? 'disabled' : ''} data-testid="button-deletion-check">${status.loading ? 'Checking…' : 'Check now'}</button>
          ${d.status === 'pending' ? `<button class="text-button" type="button" data-action="deletion-retry" ${status.retrying ? 'disabled' : ''} data-testid="button-deletion-retry">${status.retrying ? 'Retrying…' : 'Retry cleanup'}</button>` : ''}
        </div>
        <p class="field-hint">While pending, this page checks every 5 seconds.</p>`;
    }
    return publicFrame('Account deletion', 'Letting<br><em>go.</em>', 'You’ve been signed out. Cleanup continues on our side even if you close this page.', card);
  }

  function renderHomeNotice() {
    return homeNotice ? `<div class="success-banner settings-home-notice" role="status" data-testid="status-deletion-complete">${icon('check', 14)}<span>${esc(homeNotice)}</span><button class="text-button" type="button" data-action="settings-dismiss-notice">Dismiss</button></div>` : '';
  }

  // ---------- events ----------
  function handleClick(action, target, event) {
    if (!action || !(action.startsWith('settings-') || action.startsWith('recover-') || action.startsWith('deletion-'))) return false;
    switch (action) {
      case 'settings-jump': case 'settings-jump-delete': {
        event?.preventDefault();
        document.getElementById(target.dataset.target || 'settings-delete')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'settings-reload': s.error = ''; void loadSettings(); break;
      case 'settings-retry-login': securityUnavailable = ''; void loadLogin(); ctx.render(); break;
      case 'settings-remove-photo': s.draft = { ...s.draft, profileImage: '', profileImageAssetId: null }; ctx.render(); break;
      case 'settings-discard': applyEnvelope(s.data, true); s.fieldErrors = {}; s.saveError = ''; s.saveNotice = ''; s.photoError = ''; ctx.render(); break;
      case 'settings-change-email':
        s.emailNotice = ''; s.emailError = '';
        if (recentlyVerified()) { s.emailStep = 'enter'; ctx.render(); } else void startReverify('email');
        break;
      case 'settings-cancel-email': emailResource = null; s.emailStep = 'idle'; s.emailError = ''; s.emailDraft = ''; ctx.render(); break;
      case 'settings-cancel-reverify': s.reverify = null; ctx.render(); break;
      case 'settings-fresh-login': void ctx.endSession('/login'); break;
      case 'settings-verify-delete': void startReverify('delete'); break;
      case 'settings-open-password': s.passwordOpen = true; s.passwordError = ''; s.passwordNotice = ''; ctx.render(); break;
      case 'settings-cancel-password': s.passwordOpen = false; s.passwordError = ''; ctx.render(); break;
      case 'settings-shelf-page': void loadShelves(Number(target.dataset.page) || 0); break;
      case 'settings-dismiss-notice': homeNotice = ''; ctx.render(); break;
      case 'recover-resend': void sendRecovery(recover.email); break;
      case 'recover-signout': void ctx.endSession('/recover'); break;
      case 'recover-restart': recover.step = 'request'; recover.error = ''; recover.notice = ''; ctx.render(); break;
      case 'deletion-status-check': void checkStatus(); break;
      case 'deletion-retry': void retryDeletion(); break;
      default: return false;
    }
    return true;
  }
  function handleSubmit(form) {
    const kind = form.dataset.form || '';
    if (kind === 'settings-profile') void saveProfile();
    else if (kind === 'settings-reverify') void finishReverify(form);
    else if (kind === 'settings-email' && !s.emailBusy) void beginEmail(form);
    else if (kind === 'settings-email-code' && !s.emailBusy) void verifyEmail(form);
    else if (kind === 'settings-password' && !s.passwordBusy) void changePassword(form);
    else if (kind === 'settings-delete') void submitDeletion();
    else if (kind === 'recover-request') void sendRecovery(form.querySelector('[name="recoveryEmail"]')?.value.trim() || '');
    else if (kind === 'recover-complete' && !recover.busy) void completeRecovery(form);
    else return false;
    return true;
  }
  function handleInput(target) {
    const name = target.name;
    if (s.draft && ['settingsName', 'settingsUsername', 'settingsBiography'].includes(name)) {
      const key = { settingsName: 'name', settingsUsername: 'username', settingsBiography: 'biography' }[name];
      s.draft = { ...s.draft, [key]: target.value };
      s.saveNotice = '';
      if (s.fieldErrors[key]) { const next = { ...s.fieldErrors }; delete next[key]; s.fieldErrors = next; target.removeAttribute('aria-invalid'); document.getElementById(`settings-${key}-error`)?.remove(); }
      if (key === 'username') queueUsernameCheck(target.value);
      return true;
    }
    if (name === 'newEmail') { s.emailDraft = target.value; return true; }
    if (name === 'deleteTyped') { s.deleteTyped = target.value; paintDeleteButton(); return true; }
    return false;
  }
  function paintDeleteButton() {
    const button = document.querySelector('[data-settings-delete-submit]');
    const role = ctx.activeAccount()?.role;
    if (button) button.disabled = s.deleteBusy || !deletionReady({ typed: s.deleteTyped, permanent: s.deletePermanent, cascade: s.deleteCascade, role });
  }
  function handleChange(target) {
    if (target.matches?.('[data-settings-photo]')) { void selectPhoto(target); return true; }
    if (target.matches?.('[data-settings-shelf]')) { void setShelfVisibility(target.dataset.settingsShelf, target.value); return true; }
    if (target.name === 'deletePermanent') { s.deletePermanent = target.checked; paintDeleteButton(); return true; }
    if (target.name === 'deleteCascade') { s.deleteCascade = target.checked; paintDeleteButton(); return true; }
    return false;
  }
  function onRouteChange(from, to) {
    if (from === to) return;
    if (from === '/deletion-status') { stopPolling(); status.token += 1; status.loading = false; status.retrying = false; }
    if (to === '/deletion-status') { status.data = null; status.missing = false; status.error = ''; }
    if (from === '/recover') window.clearTimeout(recover.timer);
    if (to === '/recover' && recover.step === 'done') { recover.step = 'request'; recover.error = ''; recover.notice = ''; }
    if (from === '/settings') {
      window.clearTimeout(s.usernameTimer);
      emailResource = null;
      s.token += 1;
      s.reverify = null; s.emailStep = 'idle'; s.passwordOpen = false;
      s.loading = false; s.saving = false; s.photoUploading = false; s.emailBusy = false; s.passwordBusy = false; s.deleteBusy = false;
      s.data = null; s.draft = null; s.shelfLoaded = false; s.shelfPending = {};
    }
  }
  function afterRender() {
    if (route() === '/recover') tickCooldown();
    if (route() === '/deletion-status' && !status.timer) schedulePoll();
  }
  function editorActive() { return route() === '/settings' && Boolean(s.saving || s.photoUploading || s.emailBusy || s.passwordBusy || s.deleteBusy || s.reverify); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedulePoll(); else stopPolling(); });

  return {
    reset, renderSettings, renderRecover, renderDeletionStatus, renderHomeNotice,
    handleClick, handleSubmit, handleInput, handleChange, onRouteChange, afterRender, editorActive,
  };
}
