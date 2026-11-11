import './index.css';
import './profile.css';
import './navigation.css';
import { appendPublicSnapshot, patchInteraction, PUBLIC_WINDOW_LIMIT } from './publicContent.js';
import { createProfile, getBootstrap, getComments, getShelves, runAction, uploadFile } from './api.js';
import { clerk, clerkAppearance, loadClerk } from './clerk.js';
import { createCuration, parseBoardRoute } from './curation.js';
import { createSettings } from './settings.js';

const app = document.querySelector('#app');
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const navItems = [
  { path: '/home', label: 'Feed', icon: 'home' },
  { path: '/explore', label: 'Explore', icon: 'explore' },
  { path: '/shelves', label: 'My Space', icon: 'shelves' },
  { path: '/profile', label: 'Profile', icon: 'profile' },
];

const state = {
  accounts: [],
  commentPagination: {},
  commentReaders: {},
  commentReadErrors: {},
  commentWindows: {},
  shelfPage: 0,
  shelfPagination: { page: 0, hasMore: false },
  shelfPickerPage: 0,
  shelfPickerHasMore: false,
  shelfPickerBusy: false,
  shelfPickerScope: [],
  interactionPrompt: null,
  boards: [],
  posts: [],
  reposts: [],
  comments: [],
  followedArtistsByFan: {},
  shelves: [],
  nextShelfId: 1,
  postDrafts: {},
  activeAccountId: null,
  route: getRoute(),
  authUserId: null,
  authLoading: true,
  authActionLoading: false,
  authNotice: null,
  dataLoading: true,
  contentPage: 0,
  contentCursor: null,
  discovery: null,
  contentRefreshing: false,
  contentRefreshError: '',
  contentPagination: { page: 0, pageSize: 20, hasMore: false },
  dataError: '',
  profileSetupLoading: false,
  profileSetupError: '',
  pendingRole: null,
  draft: { role: null, name: '', username: '', email: '' },
  errors: {},
  loading: false,
  pendingAccount: null,
  registrationTimer: null,
  successAccountId: null,
  homeTab: 'for-you',
  searchOpen: false,
  editingProfile: false,
  profileDraft: null,
  profileError: '',
  profileFieldErrors: {},
  profileImageLoading: false,
  profileImageError: '',
  profileImageToken: 0,
  profileLoading: false,
  profilePending: null,
  profileTimer: null,
  profileStatus: null,
  profileActivityTabs: {},
  usernameEditorOpen: false,
  usernameDraft: '',
  usernameError: '',
  usernameLoading: false,
  usernamePending: null,
  usernameTimer: null,
  usernameStatus: null,
  exploreQuery: '',
  exploreDiscipline: 'all',
  exploreLoading: false,
  exploreError: '',
  exploreTimer: null,
  boardDraft: null,
  boardErrors: {},
  boardLoading: false,
  boardTimer: null,
  pendingBoard: null,
  boardImageLoading: false,
  boardImageError: '',
  boardImageReadToken: 0,
  boardCoverToken: 0,
  boardCoverLoading: false,
  boardCoverError: '',
  boardSuccess: '',
  boardSuccessId: null,
  postEditor: null,
  postErrors: {},
  postPublishing: false,
  postMediaLoading: false,
  postUploadProgress: 0,
  postMediaToken: 0,
  postMediaError: '',
  pendingPost: null,
  postTimer: null,
  nextPostId: 1,
  nextRepostId: 1,
  nextCommentId: 1,
  postStatus: null,
  deleteConfirmPostId: null,
  followStatus: null,
  repostConfirm: null,
  repostPending: null,
  repostTimer: null,
  repostStatus: null,
  expandedCommentPostIds: [],
  commentDrafts: {},
  commentErrors: {},
  commentEditor: null,
  commentDeleteConfirmId: null,
  commentPending: null,
  commentTimer: null,
  commentStatus: null,
  shelfDraft: null,
  shelfErrors: {},
  shelfLoading: false,
  shelfTimer: null,
  pendingShelf: null,
  shelfPickerPostId: null,
  shelfPickerSelection: [],
  shelfPickerError: '',
  shelfReturnPostId: null,
  shelfReturnRoute: null,
  shelfDeleteConfirmId: null,
  shelfStatus: null,
  shelfSignupPromptOpen: false,
  shelfSignupPromptFocusKey: '',
};

let authWidget = null;
let syncInFlight = null;
let observedClerkSession = undefined;
let authGeneration = 0;
const curation = createCuration({
  state, escapeHTML, icon, hrefFor, renderEmpty, activeAccount,
  render: () => render(), navigate: (path) => navigate(path),
  renderPostCard: (post) => renderPostCard(post), getAuthGeneration: () => authGeneration,
});

const settings = createSettings({
  escapeHTML, icon, hrefFor, header: (options) => header(options), renderEmpty: (...args) => renderEmpty(...args), activeAccount,
  getAuthGeneration: () => authGeneration, getRoute: () => state.route,
  render: () => render(), navigate: (path) => navigate(path),
  persistAction: (action, payload) => persistAction(action, payload),
  refreshContent: () => refreshPublicContent({ background: true }),
  endSession: (destination) => endSession(destination),
  signOutForDeletion: () => signOutForDeletion(),
});

async function signOutForDeletion() {
  // Deletion has been recorded server-side; end this browser session and drop private state.
  authGeneration += 1;
  window.sessionStorage.removeItem('stillroom.pendingRole');
  window.sessionStorage.removeItem('stillroom.intent');
  clearAccountEditors();
  state.pendingRole = null;
  state.activeAccountId = null;
  state.authUserId = null;
  navigate('/deletion-status', { replace: true, refresh: false });
  try { await clerk?.signOut(); } catch { /* The server already revoked access; the status page stays truthful. */ }
  navigate('/deletion-status', { replace: true, refresh: false });
}

function clearAccountEditors() {
  settings.reset();
  state.commentPagination = {};
  state.commentReaders = {};
  state.commentReadErrors = {};
  state.commentWindows = {};
  state.shelfPage = 0;
  state.shelfPickerScope = [];
  state.shelfPickerBusy = false;
  state.interactionPrompt = null;
  state.contentPage = 0;
  state.contentCursor = null;
  state.discovery = null;
  state.contentPagination = { page: 0, pageSize: 20, hasMore: false };
  state.contentRefreshError = '';
  state.contentRefreshing = false;
  cancelProfileOperation();
  resetUsernameEditor();
  Object.values(state.postDrafts).forEach(releaseDraftMedia);
  state.postDrafts = {};
  state.followedArtistsByFan = {};
  state.shelves = state.shelves.filter((shelf) => shelf.visibility === 'public');
  state.profileDraft = null;
  state.profileError = '';
  state.profileFieldErrors = {};
  state.profileImageToken += 1;
  state.profileImageLoading = false;
  state.boardDraft = null;
  state.boardErrors = {};
  state.boardLoading = false;
  state.pendingBoard = null;
  state.boardSuccess = '';
  state.boardSuccessId = null;
  state.boardImageReadToken += 1;
  state.boardImageLoading = false;
  state.boardCoverToken += 1;
  state.boardCoverLoading = false;
  state.boardCoverError = '';
  curation.reset();
  state.postMediaToken += 1;
  state.postMediaLoading = false;
  state.postEditor = null;
  state.postPublishing = false;
  state.pendingPost = null;
  state.postErrors = {};
  state.postStatus = null;
  state.commentDrafts = {};
  state.commentErrors = {};
  state.commentPending = null;
  state.commentEditor = null;
  state.commentStatus = null;
  state.commentDeleteConfirmId = null;
  state.repostConfirm = null;
  state.repostPending = null;
  state.repostStatus = null;
  state.shelfPickerPostId = null;
  state.shelfPickerSelection = [];
  state.shelfPickerError = '';
  state.shelfDraft = null;
  state.shelfLoading = false;
  state.pendingShelf = null;
  state.shelfReturnPostId = null;
  state.shelfReturnRoute = null;
  state.followStatus = null;
  state.shelfErrors = {};
  state.shelfStatus = null;
  state.shelfDeleteConfirmId = null;
  state.profileSetupLoading = false;
  state.profileSetupError = '';
  state.draft = { role: null, name: '', username: '', email: '' };
  state.errors = {};
  state.successAccountId = null;
  state.editingProfile = false;
}

function renderAuthNotice() {
  const notice = state.authNotice;
  return notice
    ? `<p class="${notice.kind === 'error' ? 'inline-error' : 'field-hint'}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${escapeHTML(notice.message)}</p>`
    : '';
}

async function endSession(destination = '/home') {
  if (!clerk || state.authActionLoading) return;
  state.authActionLoading = true;
  state.authNotice = null;
  render();
  try {
    window.sessionStorage.setItem('stillroom.signedOut', '1');
    await clerk.signOut({ redirectUrl: hrefFor(destination) });
    window.sessionStorage.removeItem('stillroom.pendingRole');
    state.pendingRole = null;
    authGeneration += 1;
    clearAccountEditors();
    state.activeAccountId = null;
    state.authUserId = null;
    await syncSession();
    state.authNotice = { kind: 'success', message: 'You’re signed out. Your saved content is safe.' };
    navigate(destination);
  } catch (error) {
    window.sessionStorage.removeItem('stillroom.signedOut');
    state.authNotice = { kind: 'error', message: error.message || 'Sign-out failed. Please try again.' };
  } finally {
    state.authActionLoading = false;
    render();
  }
}

const iconPaths = {
  home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/>',
  explore: '<circle cx="11" cy="11" r="7.5"/><path d="m16.5 16.5 4 4M13.8 8.2l-1.7 4-4 1.7 1.7-4z"/>',
  artists: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="8.5"/>',
  shelves: '<path d="M4 5.5h16M4 12h16M4 18.5h16"/><path d="M7 3v5M17 9.5v5M10 16v5"/>',
  profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m16.5 16.5 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  back: '<path d="m15 18-6-6 6-6M9 12h12"/>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
  edit: '<path d="m14 5 5 5M4 20l4.2-.9L19 8.3 15.7 5 4.9 15.8 4 20Z"/><path d="M12 20h8"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  repost: '<path d="m17 3 4 4-4 4"/><path d="M3 11V9a2 2 0 0 1 2-2h16"/><path d="m7 21-4-4 4-4"/><path d="M21 13v2a2 2 0 0 1-2 2H3"/>',
};

function icon(name, size = 17) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function getRoute() {
  let path = window.location.pathname;
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length) || '/';
  return path || '/';
}

function hrefFor(path) {
  return `${basePath}${path === '/' ? '/' : path}`;
}

function applyBootstrap(data, { append = false } = {}) {
  if (append) data = appendPublicSnapshot({
    userId: state.authUserId, profileId: state.activeAccountId,
    posts: state.posts, boards: state.boards, accounts: state.accounts,
    comments: state.comments, reposts: state.reposts, discovery: state.discovery,
  }, data);
  if (state.activeAccountId !== (data.profileId || null)) clearAccountEditors();
  const localDrafts = data.profileId && state.activeAccountId === data.profileId
    ? state.postDrafts
    : {};
  state.authUserId = data.userId || null;
  state.accounts = data.accounts || [];
  state.boards = data.boards || [];
  state.posts = data.posts || [];
  state.discovery = data.discovery || null;
  state.contentPagination = data.pagination || { page: 0, pageSize: 20, hasMore: false };
  state.comments = data.comments || [];
  state.commentPagination = data.commentPagination || {};
  state.shelfPagination = data.shelfPagination || { page: 0, hasMore: false };
  state.reposts = data.reposts || [];
  state.shelves = data.shelves || [];
  state.followedArtistsByFan = data.followedArtistsByFan || {};
  state.postDrafts = { ...(data.postDrafts || {}), ...localDrafts };
  state.activeAccountId = data.profileId || null;
  state.dataLoading = false;
  state.dataError = '';
  curation.afterBootstrap(data.interactionPostId ? null : data.posts);
}

function unmountAuthWidget() {
  if (!clerk || !authWidget) return;
  try {
    if (authWidget.type === 'sign-up') clerk.unmountSignUp(authWidget.node);
    else clerk.unmountSignIn(authWidget.node);
  } catch {
    // The Clerk component may already have been detached during navigation.
  }
  authWidget = null;
}

function mountAuthWidget(type, id) {
  if (!clerk || !clerk.loaded) return;
  const node = document.getElementById(id);
  if (!node) return;
  node.replaceChildren();
  if (type === 'sign-up') {
    clerk.mountSignUp(node, {
      appearance: clerkAppearance,
      signInUrl: hrefFor('/login'),
      forceRedirectUrl: hrefFor('/profile/setup'),
    });
  } else {
    clerk.mountSignIn(node, {
      appearance: clerkAppearance,
      signUpUrl: hrefFor('/register'),
      forceRedirectUrl: hrefFor('/home'),
    });
  }
  authWidget = { type, node };
}

async function syncSession() {
  if (syncInFlight) return syncInFlight;
  const generation = authGeneration;
  let selectionChanged = false;
  syncInFlight = (async () => {
    state.dataLoading = true;
    state.dataError = '';
    render();
    try {
      const selection = contentSelection();
      const data = await getBootstrap(selection);
      if (generation !== authGeneration) return;
      applyBootstrap(data);
      state.contentRefreshError = '';
      selectionChanged = JSON.stringify(selection) !== JSON.stringify(contentSelection());
      state.authLoading = false;
      if (data.userId && !data.profileId) {
        const role = window.sessionStorage.getItem('stillroom.pendingRole');
        state.pendingRole = role === 'Fan' || role === 'Artist' ? role : null;
        state.draft.role = state.pendingRole;
        if (!['/profile/setup', '/confirmation'].includes(state.route)) {
          navigate('/profile/setup', { replace: true });
        }
      } else if (data.profileId) {
        window.sessionStorage.removeItem('stillroom.pendingRole');
        if (['/register', '/login', '/profile/setup'].includes(state.route)) {
          navigate('/home', { replace: true });
        }
      }
      render();
    } catch (error) {
      if (generation !== authGeneration) return;
      state.authLoading = false;
      state.dataLoading = false;
      state.dataError = error.message || 'Stillroom could not load right now.';
      render();
    }
  })().finally(() => {
    syncInFlight = null;
    if (generation !== authGeneration) void syncSession();
    else if (state.activeAccountId && window.sessionStorage.getItem('stillroom.intent')) void resumeInteraction();
    else if (selectionChanged) void refreshPublicContent();
  });
  return syncInFlight;
}

async function persistAction(action, payload = {}) {
  // Mutations replace the snapshot: discard accumulated public cursors first.
  const targeted = action.startsWith('comment.') || action.startsWith('repost.') || ['shelf.setPosts', 'shelf.addPost', 'shelf.removePost'].includes(action);
  if (!targeted && ['/', '/home', '/explore'].includes(state.route)) state.contentCursor = null;
  contentRefreshId += 1;
  state.contentRefreshing = false;
  const generation = authGeneration;
  const selection = contentSelection();
  const selectionKey = JSON.stringify(selection);
  let data = await runAction(action, payload, selection);
  if (generation !== authGeneration) throw new Error('Your session changed. Please sign in and try again.');
  curation.afterMutation(action, payload, data);
  if (selectionKey !== JSON.stringify(contentSelection())) {
    await refreshPublicContent();
    return data;
  }
  if (data.interactionPostId) {
    const previousPagination = state.commentPagination;
    data = patchInteraction({ userId: state.authUserId, profileId: state.activeAccountId,
      posts: state.posts, comments: state.comments, reposts: state.reposts, shelves: state.shelves,
      accounts: state.accounts, boards: state.boards, discovery: state.discovery,
      pagination: state.contentPagination, shelfPagination: state.shelfPagination,
      commentPagination: state.commentPagination }, data, action, payload);
    if (state.commentWindows[data.interactionPostId] && !(action === 'comment.save' && !payload.commentId)) {
      data.commentPagination[data.interactionPostId] = previousPagination[data.interactionPostId];
    } else if (action === 'comment.save' && !payload.commentId) state.commentWindows[data.interactionPostId] = false;
  }
  applyBootstrap(data);
  state.contentRefreshError = '';
  render();
  return data;
}

function handleClerkSession({ session }) {
  const sessionId = session?.id || null;
  if (observedClerkSession === sessionId) return;
  observedClerkSession = sessionId;
  authGeneration += 1;
  state.authNotice = null;
  if (sessionId) window.sessionStorage.removeItem('stillroom.signedOut');
  clearAccountEditors();
  state.authUserId = null;
  state.activeAccountId = null;
  // Replace the previous account's DOM even if syncSession joins an old request.
  state.authLoading = true;
  state.dataLoading = true;
  state.dataError = '';
  render();
  void syncSession();
}

async function startStillroom() {
  render();
  try {
    await loadClerk();
    clerk.addListener(handleClerkSession);
    await syncSession();
    if (!state.authUserId && !state.dataError && window.sessionStorage.getItem('stillroom.signedOut')) {
      window.sessionStorage.removeItem('stillroom.signedOut');
      state.authNotice = { kind: 'success', message: 'You’re signed out. Your saved content is safe.' };
      render();
    }
  } catch (error) {
    state.authLoading = false;
    state.dataLoading = false;
    state.dataError = error.message || 'Sign-in is not available right now.';
    render();
  }
}

function navigate(path, { replace = false, refresh = true } = {}) {
  const changed = state.route !== path;
  if (path !== '/shelves') {
    state.shelfSignupPromptOpen = false;
    state.shelfSignupPromptFocusKey = '';
  }
  if (state.loading && path !== state.route) cancelRegistration();
  if (state.boardLoading && path !== state.route) cancelBoardOperation();
  if (state.shelfLoading && path !== state.route) cancelShelfOperation();
  if (state.exploreTimer && !path.startsWith('/explore')) {
    window.clearTimeout(state.exploreTimer);
    state.exploreTimer = null;
    state.exploreLoading = false;
  }
  if (replace) history.replaceState({}, '', hrefFor(path));
  else if (getRoute() !== path) history.pushState({}, '', hrefFor(path));
  curation.onRouteChange(state.route, path);
  settings.onRouteChange(state.route, path);
  state.route = path;
  if (changed) {
    state.contentPage = 0;
    state.shelfPage = 0;
    state.contentCursor = null;
  }
  render();
  if (changed && refresh) {
    void refreshPublicContent();
  }
}

function contentSelection() {
  const selection = { page: state.contentPage || 0 };
  selection.shelfPage = state.shelfPage || 0;
  if (state.route === '/shelves') selection.shelfList = 'true';
  if (state.route === '/artists') selection.artistList = 'true';
  if (['/', '/home', '/explore'].includes(state.route)) {
    selection.page = 0;
    selection.view = state.route === '/explore' ? 'explore' : 'feed';
    if (state.contentCursor) selection.cursor = state.contentCursor;
  }
  const parts = state.route.split('/').map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (parts[1] === 'board' && parts[2]) selection.boardId = parts[2];
  if (parts[1] === 'post' && parts[2]) selection.postId = parts[2];
  if (parts[1] === 'shelves' && parts[2] && parts[2] !== 'new') selection.shelfId = parts[2];
  if (parts[1] === 'profile') {
    const id = parts[2] || state.activeAccountId;
    if (id && id !== 'setup') {
      if (state.profileActivityTabs[id] === 'reposts') selection.repostsBy = id;
      else selection.profileId = id;
      // Keep the Artist's Board header available even on an empty Reposts tab.
      if (state.accounts.find((account) => account.id === id)?.role === 'Artist') selection.profileId = id;
      // Request the existing private Artist-list scope only for its Fan owner.
      if (id === state.activeAccountId && activeAccount()?.role === 'Fan') selection.artistList = 'true';
    } else if (!parts[2]) selection.mine = 'true';
  }
  if (['/', '/home'].includes(state.route) && state.homeTab === 'my-artists') selection.followed = 'true';
  if (state.route === '/explore') {
    if (state.exploreQuery.trim()) selection.q = state.exploreQuery.trim();
    if (state.exploreDiscipline !== 'all') selection.category = state.exploreDiscipline;
  }
  return selection;
}

let contentRefreshId = 0;
async function refreshPublicContent({ background = false, append = false } = {}) {
  // Never replace an editor, a pending mutation, or an authentication form.
  if (state.authLoading || syncInFlight || !clerk?.loaded) return;
  const selection = contentSelection();
  const key = JSON.stringify(selection);
  const generation = authGeneration;
  const requestId = ++contentRefreshId;
  if (!background) { state.contentRefreshing = true; renderPublicContent(); }
  try {
    const data = await getBootstrap(selection);
    if (generation !== authGeneration || requestId !== contentRefreshId || key !== JSON.stringify(contentSelection())) return;
    applyBootstrap(data, { append });
    state.contentRefreshError = '';
    if (parseBoardRoute(state.route) && !curation.editorActive()) void curation.load({ force: true, background });
  } catch (error) {
    if (generation !== authGeneration || requestId !== contentRefreshId || key !== JSON.stringify(contentSelection())) return;
    if (error.status === 404 && selection.shelfId) state.shelves = state.shelves.filter((shelf) => shelf.id !== selection.shelfId);
    state.contentRefreshError = error.message || 'Could not refresh public content.';
  } finally {
    if (generation === authGeneration && requestId === contentRefreshId) {
      state.contentRefreshing = false;
      if (!background || !publicEditorActive()) renderPublicContent();
    }
  }
}

function renderPublicContent() {
  const search = app.querySelector('[data-explore-search]');
  const focused = search && document.activeElement === search;
  const start = focused ? search.selectionStart : null;
  const end = focused ? search.selectionEnd : null;
  render();
  if (focused && state.route === '/explore') {
    const next = app.querySelector('[data-explore-search]');
    next?.focus({ preventScroll: true });
    if (start !== null) next?.setSelectionRange(start, end);
  }
}

function publicEditorActive() {
  return Boolean(state.shelfPickerPostId || state.shelfPickerBusy || state.interactionPrompt
    || state.expandedCommentPostIds.some((id) => state.commentWindows[id])
    || Object.keys(state.commentReaders).length || state.postEditor || state.boardDraft || state.profileDraft || state.shelfDraft
    || state.postPublishing || state.postMediaLoading || state.boardLoading || state.commentPending
    || state.shelfLoading || state.usernameLoading || state.editingProfile || state.repostPending
    || state.boardCoverLoading || curation.editorActive() || settings.editorActive()
    || document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]'));
}

function renderContentPagination() {
  if (state.route === '/shelves' || (state.route.startsWith('/profile')
    && state.profileActivityTabs[state.route.split('/')[2] || state.activeAccountId] === 'shelves')) {
    const page = state.shelfPage || 0;
    if (!page && !state.shelfPagination.hasMore && !state.contentRefreshError) return '';
    return `<nav class="content-pagination" aria-label="Shelf pages">
      ${state.contentRefreshError ? `<p class="inline-error" role="alert">${escapeHTML(state.contentRefreshError)} <button class="text-button" type="button" data-action="refresh-public-content">Try again</button></p>` : ''}
      <button class="quiet-button" type="button" data-action="shelf-page" data-page="${Math.max(0, page - 1)}" ${!page || state.contentRefreshing ? 'disabled' : ''}>Previous</button>
      <span role="status">${state.contentRefreshing ? 'Loading…' : `Page ${page + 1}`}</span>
      <button class="quiet-button" type="button" data-action="shelf-page" data-page="${page + 1}" ${!state.shelfPagination.hasMore || state.contentRefreshing ? 'disabled' : ''}>Next</button>
    </nav>`;
  }
  if (['/', '/home', '/explore'].includes(state.route)) {
    const pending = state.contentRefreshing || state.postPublishing || state.repostPending || state.commentPending || state.shelfLoading;
    const hasMore = state.contentPagination?.hasMore && state.contentPagination?.nextCursor;
    if (!hasMore && !state.contentRefreshing && !state.contentRefreshError && !state.contentCursor) return '';
    return `<nav class="content-pagination" aria-label="More public content">
      ${state.contentRefreshError ? `<p class="inline-error" role="alert">${escapeHTML(state.contentRefreshError)}</p>` : ''}
      ${state.posts.length >= PUBLIC_WINDOW_LIMIT ? `<span role="status">Showing the last ${PUBLIC_WINDOW_LIMIT} loaded posts.</span>` : ''}
      ${hasMore ? `<button class="quiet-button" type="button" data-action="load-public-more" ${pending ? 'disabled' : ''}>${state.contentRefreshing ? 'Loading…' : 'Load More'}</button>` : state.contentRefreshing ? '<span role="status">Loading…</span>' : ''}
      ${state.contentCursor || state.contentRefreshError ? `<button class="text-button" type="button" data-action="refresh-public-content" ${pending ? 'disabled' : ''}>${state.contentRefreshError ? 'Try again' : 'Back to newest'}</button>` : ''}
    </nav>`;
  }
  if (!['/home', '/explore', '/profile'].includes(state.route)
    && !/^\/(?:board|profile|shelves)\/[^/]+$/.test(state.route)) return '';
  if (state.route.startsWith('/profile') && state.profileActivityTabs[state.route.split('/')[2] || state.activeAccountId] === 'shelves') return '';
  const page = state.contentPage || 0;
  const hasMore = state.contentPagination?.hasMore;
  const busy = state.contentRefreshing || publicEditorActive();
  if (!page && !hasMore && !state.contentRefreshError && !state.contentRefreshing) return '';
  return `<nav class="content-pagination" aria-label="Content pages">
    ${state.contentRefreshError ? `<p class="inline-error" role="alert">${escapeHTML(state.contentRefreshError)} <button class="text-button" type="button" data-action="refresh-public-content">Try again</button></p>` : ''}
    ${page || hasMore ? `<button class="quiet-button" type="button" data-action="content-page" data-page="${Math.max(0, page - 1)}" ${!page || busy ? 'disabled' : ''}>Previous</button><span role="status">${state.contentRefreshing ? 'Loading…' : `Page ${page + 1}`}</span><button class="quiet-button" type="button" data-action="content-page" data-page="${page + 1}" ${!hasMore || busy ? 'disabled' : ''}>Next</button>` : '<span role="status">Refreshing…</span>'}
  </nav>`;
}

function cancelRegistration() {
  if (state.registrationTimer) window.clearTimeout(state.registrationTimer);
  state.registrationTimer = null;
  state.loading = false;
  state.pendingAccount = null;
}

function cancelBoardOperation() {
  if (state.boardTimer) window.clearTimeout(state.boardTimer);
  state.boardTimer = null;
  state.boardLoading = false;
  state.pendingBoard = null;
}

function cancelShelfOperation() {
  if (state.shelfTimer) window.clearTimeout(state.shelfTimer);
  state.shelfTimer = null;
  state.shelfLoading = false;
  state.pendingShelf = null;
  state.shelfReturnPostId = null;
  state.shelfReturnRoute = null;
}

function activeAccount() {
  return state.accounts.find((account) => account.id === state.activeAccountId) || null;
}
function canComment(account = activeAccount()) {
  return ['Fan', 'Artist'].includes(account?.role);
}

function boardForOwner(ownerId) {
  return state.boards.find((board) => board.ownerId === ownerId) || null;
}

function followedArtistIds(fanId) {
  return state.followedArtistsByFan[fanId] || [];
}

function isFollowingArtist(fanId, artistId) {
  return followedArtistIds(fanId).includes(artistId);
}

function chronologicalPosts(posts) {
  return posts.slice().sort((left, right) => left.publishedAt - right.publishedAt);
}

function commentDraftKey(userId, postId) {
  return `${userId}::${postId}`;
}

function homeFeedItems(followedIds = null) {
  const originalIds = state.discovery ? new Set(state.discovery.postIds) : null;
  const eventIds = state.discovery?.repostIds ? new Set(state.discovery.repostIds) : null;
  const items = state.posts
    .filter((post) => isVisibleFanPost(post) && (!originalIds || originalIds.has(post.id)))
    .map((post) => ({ type: 'post', key: `post:${post.id}`, post, createdAt: post.publishedAt }));
  for (const repost of state.reposts) {
    if (eventIds && !eventIds.has(repost.id)) continue;
    const post = state.posts.find((entry) => entry.id === repost.postId);
    const reposter = state.accounts.find((entry) => entry.id === repost.userId);
    if (!post || reposter?.role !== 'Fan' || !isVisibleFanPost(post)) continue;
    items.push({ type: 'repost', key: `repost:${repost.id}`, post, repost, createdAt: repost.repostedAt });
  }
  return items
    .filter((item) => {
      if (!followedIds) return true;
      const board = state.boards.find((entry) => entry.id === item.post.boardId);
      return board && followedIds.has(board.ownerId);
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

function accountActivityItems(accountId) {
  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) return [];
  const items = state.posts
    .filter((post) => post.authorId === accountId && isVisibleFanPost(post))
    .map((post) => ({ type: 'post', key: `post:${post.id}`, post, createdAt: post.publishedAt }));
  for (const repost of state.reposts.filter((entry) => entry.userId === accountId)) {
    const post = state.posts.find((entry) => entry.id === repost.postId);
    if (post && isVisibleFanPost(post)) items.push({ type: 'repost', key: `repost:${repost.id}`, post, repost, createdAt: repost.repostedAt });
  }
  return items.sort((left, right) => left.createdAt - right.createdAt);
}

function isVisibleFanPost(post) {
  const author = state.accounts.find((account) => account.id === post.authorId);
  return author?.role === 'Fan' && state.boards.some((board) => board.id === post.boardId);
}

const exploreDisciplines = ['Music', 'Film', 'Photography', 'Painting', 'Fashion'];

function disciplineMatchesFilter(discipline, filter) {
  if (filter === 'all') return true;
  const value = String(discipline || '').trim().toLocaleLowerCase();
  const aliases = {
    Music: ['music', 'musician', 'singer', 'songwriter', 'composer', 'sound'],
    Film: ['film', 'filmmaker', 'cinema', 'cinematographer', 'director'],
    Photography: ['photography', 'photographer', 'photo'],
    Painting: ['painting', 'painter'],
    Fashion: ['fashion', 'clothing', 'textile'],
  };
  const containsDisciplineTerm = (category) => aliases[category].some((term) => new RegExp(`(^|[^a-z])${term}([^a-z]|$)`, 'i').test(value));
  if (filter === 'Other') return !exploreDisciplines.some(containsDisciplineTerm);
  return containsDisciplineTerm(filter) || value === filter.toLocaleLowerCase();
}

function exploreTextMatches(query, values) {
  const terms = query.trim().toLocaleLowerCase().replaceAll('@', '').split(/\s+/).filter(Boolean);
  const searchable = values.flat(Infinity)
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).toLocaleLowerCase())
    .join(' ');
  return terms.every((term) => searchable.includes(term));
}

function exploreResults() {
  if (state.discovery) {
    const posts = new Set(state.discovery.postIds);
    return {
      artists: state.discovery.artistIds.map((id) => state.accounts.find((account) => account.id === id)).filter(Boolean),
      boards: state.discovery.boardIds.map((id) => state.boards.find((board) => board.id === id)).filter(Boolean),
      posts: state.posts.filter((post) => posts.has(post.id) && isVisibleFanPost(post)),
    };
  }
  const query = state.exploreQuery;
  const discipline = state.exploreDiscipline;
  const boards = state.boards
    .filter((board) => {
      const owner = state.accounts.find((account) => account.id === board.ownerId);
      return disciplineMatchesFilter(board.discipline, discipline)
        && exploreTextMatches(query, [board.artistName, board.discipline, board.biography, owner?.name, owner?.username]);
    })
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

  const artists = state.accounts
    .filter((account) => account.role === 'Artist')
    .filter((account) => {
      const board = boardForOwner(account.id);
      return (discipline === 'all' || (board && disciplineMatchesFilter(board.discipline, discipline)))
        && exploreTextMatches(query, [account.name, account.username, board?.artistName, board?.discipline, board?.biography]);
    })
    .sort((left, right) => {
      const leftBoard = boardForOwner(left.id);
      const rightBoard = boardForOwner(right.id);
      return (rightBoard?.createdAt || right.createdAt || 0) - (leftBoard?.createdAt || left.createdAt || 0);
    });

  const posts = state.posts
    .filter((post) => {
      if (!isVisibleFanPost(post)) return false;
      const board = state.boards.find((entry) => entry.id === post.boardId);
      const author = state.accounts.find((entry) => entry.id === post.authorId);
      const artist = state.accounts.find((entry) => entry.id === board?.ownerId);
      const keywords = Array.isArray(post.keywords) ? post.keywords : [post.keywords];
      return board
        && disciplineMatchesFilter(board.discipline, discipline)
        && exploreTextMatches(query, [
          board.artistName, board.discipline, artist?.name, artist?.username,
          author?.name, author?.username, post.title, post.artworkTitle, post.content,
          keywords, post.media?.name,
        ]);
    })
    .sort((left, right) => right.publishedAt - left.publishedAt);

  return { artists, boards, posts };
}

function postDraftKey(authorId, boardId, postId = null) {
  return `${authorId}::${boardId}::${postId || 'new'}`;
}

function releaseDraftMedia(draft) {
  if (draft?.media?.isNew && draft.media.url?.startsWith('blob:')) {
    URL.revokeObjectURL(draft.media.url);
  }
}

function formatPostDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

function brand(linked = true) {
  const contents = `<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M20 3.8 36.2 13.2v13.6L20 36.2 3.8 26.8V13.2L20 3.8Z" stroke="currentColor" stroke-width="1.5"/><path d="M12.1 12.2h15.8v15.6H12.1z" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.4"/><path d="m12.2 27.8 15.6-15.6M20 12.2v15.6" stroke="currentColor" stroke-width="1.4"/></svg></span><span class="brand-name">stillroom</span>`;
  return linked
    ? `<a class="brand" href="${hrefFor('/')}" data-route="/" data-testid="link-brand" aria-label="Stillroom home">${contents}</a>`
    : `<span class="brand" aria-label="Stillroom">${contents}</span>`;
}

function header({ right = '' } = {}) {
  return `<header class="landing-header">${brand()}${right}</header>`;
}

function renderAccountChoice(account, current = false, profileLink = false) {
  const profileRoute = `/profile/${encodeURIComponent(account.id)}`;
  const usernameLink = `<a class="account-choice-profile-link" href="${hrefFor(profileRoute)}" data-route="${profileRoute}">@${escapeHTML(account.username)}</a>`;
  const details = profileLink
    ? `<span class="account-choice-name">${escapeHTML(account.name)}</span><span class="account-choice-role">${current ? 'Current · ' : ''}${escapeHTML(account.role)}</span>`
    : `<span><span class="account-choice-name">${escapeHTML(account.name)}</span><span class="account-choice-meta">@${escapeHTML(account.username)}</span></span><span class="account-choice-role">${current ? 'Current · ' : ''}${escapeHTML(account.role)}</span>`;
  if (profileLink) {
    const choice = current
      ? `<div class="account-choice switcher-current" aria-current="true">${details}</div>`
      : `<button class="account-choice" type="button" data-action="switch-account" data-account-id="${escapeHTML(account.id)}">${details}${icon('arrow', 14)}</button>`;
    return `<div class="account-choice-row">${choice}${usernameLink}</div>`;
  }
  return current
    ? `<div class="account-choice switcher-current" aria-current="true">${details}</div>`
    : `<button class="account-choice" type="button" data-action="switch-account" data-account-id="${escapeHTML(account.id)}">${details}${icon('arrow', 14)}</button>`;
}

function renderWelcome() {
  const accountPicker = '';
  return `<div class="paper-grain landing-page page-enter">
    ${header()}
    <main class="welcome-layout">
      <section class="welcome-copy">
        <p class="eyebrow">A quieter kind of gathering</p>
        <h1 class="welcome-title">For the work<br>that stays <em>with you.</em></h1>
        <p class="welcome-description">Stillroom is a home for people who care about art. Gather around artists, make room for the work, and share what moves you — without the noise of popularity.</p>
        <div class="welcome-actions">
          <button class="primary-button" type="button" data-action="join" data-role="Fan" data-testid="button-join-fan">Join as Fan ${icon('arrow', 15)}</button>
          <button class="outline-button" type="button" data-action="join" data-role="Artist" data-testid="button-join-artist">Join as Artist ${icon('arrow', 15)}</button>
        </div>
        <p class="welcome-note">A place to linger, not perform.</p>
        ${accountPicker}
      </section>
      <aside class="welcome-side" aria-label="Stillroom principles">
        <p class="eyebrow">What we keep</p>
        <div class="manifesto">
          <div class="manifesto-row"><span class="manifesto-number">01</span><div><h2 class="manifesto-title">Artist-led rooms</h2><p class="manifesto-copy">Artists make boards. Fans make the conversation.</p></div></div>
          <div class="manifesto-row"><span class="manifesto-number">02</span><div><h2 class="manifesto-title">A slower feed</h2><p class="manifesto-copy">No scores, rankings, or follower tallies to chase.</p></div></div>
          <div class="manifesto-row"><span class="manifesto-number">03</span><div><h2 class="manifesto-title">Made for looking</h2><p class="manifesto-copy">Bring your attention. Everything else can wait.</p></div></div>
        </div>
        <p class="manifesto-footer">No audience metrics. Just a place to gather.</p>
      </aside>
    </main>
  </div>`;
}

function errorFor(field) {
  return state.errors[field]
    ? `<span class="field-error" id="error-${field}" role="alert">${escapeHTML(state.errors[field])}</span>`
    : '';
}

function renderRoleOption(role, title, copy) {
  const selected = state.draft.role === role;
  return `<button class="role-option" type="button" data-action="choose-role" data-role="${role}" aria-pressed="${selected}">
    <span class="role-option-title">${title}</span><span class="role-option-copy">${copy}</span>
  </button>`;
}

function renderRegistration() {
  const role = state.pendingRole || state.draft.role;
  return `<div class="paper-grain landing-page page-enter">
    ${header({ right: `<button class="text-button" type="button" data-action="back-from-register">${icon('back', 14)} Back to Feed</button>` })}
    <main class="registration-layout">
      <section class="registration-intro">
        <p class="eyebrow">A place without applause</p>
        <h1 class="registration-title">Make room<br>for what <em>moves you.</em></h1>
        <p class="registration-copy">Create a Stillroom account to follow artists, contribute to boards, and keep the work that matters to you.</p>
      </section>
      <section class="registration-card" aria-labelledby="registration-title">
        <p class="eyebrow">Settle in</p><h2 id="registration-title">Create your account</h2>
        <fieldset class="role-fieldset" style="border:0;padding:0;margin:0">
          <legend class="role-legend">I’m here as…</legend>
          <div class="role-options">
            ${renderRoleOption('Fan', 'Fan', 'Find artists and share your thoughts.')}
            ${renderRoleOption('Artist', 'Artist', 'Make a board for people to gather around your work.')}
          </div>
        </fieldset>
        ${state.dataError ? `<p class="inline-error" role="alert">${escapeHTML(state.dataError)}</p>` : ''}
        ${role
          ? `<p class="form-note">You’re joining as a ${escapeHTML(role)}. After confirming your sign-in details, you’ll set your name and username.</p><div id="clerk-sign-up" class="clerk-auth-container" aria-live="polite"><p class="field-hint">Loading secure sign-up…</p></div>`
          : `<p class="form-note">Choose an account type to continue. Sign-up uses secure Clerk authentication.</p>`}
        <p class="auth-alternative">Already have an account? <a href="${hrefFor('/login')}" data-route="/login" data-testid="registration-sign-in">Sign In</a></p>
      </section>
    </main>
  </div>`;
}

function renderLogin() {
  return `<div class="paper-grain landing-page page-enter">
    ${header({ right: `<button class="text-button" type="button" data-action="back-from-register">${icon('back', 14)} Back to Feed</button>` })}
    <main class="registration-layout">
      <section class="registration-intro">
        <p class="eyebrow">Welcome back</p>
        <h1 class="registration-title">Return to<br>your <em>Stillroom.</em></h1>
        <p class="registration-copy">Sign in to continue your collections and conversations.</p>
      </section>
      <section class="registration-card" aria-labelledby="login-title">
        <p class="eyebrow">Your account</p><h2 id="login-title">Sign in</h2>
        ${renderAuthNotice()}
        ${state.dataError ? `<p class="inline-error" role="alert">${escapeHTML(state.dataError)}</p>` : ''}
        <div id="clerk-sign-in" class="clerk-auth-container" aria-live="polite"><p class="field-hint">Loading secure sign-in…</p></div>
        <p class="auth-alternative"><a href="${hrefFor('/recover')}" data-route="/recover" data-testid="link-forgot-password">Forgot password?</a></p>
        <p class="auth-alternative">Don't have an account? <a href="${hrefFor('/register')}" data-route="/register" data-testid="login-sign-up">Sign Up</a></p>
      </section>
    </main>
  </div>`;
}

function renderProfileSetup() {
  const role = state.pendingRole || state.draft.role;
  return `<div class="paper-grain landing-page page-enter">
    ${header({ right: `<button class="text-button" type="button" data-action="logout" ${state.authActionLoading ? 'disabled' : ''}>${icon('logout', 14)} ${state.authActionLoading ? 'Signing out…' : 'Sign out'}</button>` })}
    <main class="registration-layout">
      <section class="registration-intro">
        <p class="eyebrow">One last step</p>
        <h1 class="registration-title">Make your<br><em>profile.</em></h1>
        <p class="registration-copy">Your account is secure. Add the details people will see around Stillroom.</p>
      </section>
      <section class="registration-card" aria-labelledby="profile-setup-title">
        <p class="eyebrow">Your Stillroom identity</p><h2 id="profile-setup-title">Complete your profile</h2>
        ${renderAuthNotice()}
        ${state.profileSetupError ? `<p class="form-error" role="alert">${escapeHTML(state.profileSetupError)}</p>` : ''}
        <form data-form="profile-setup" novalidate aria-busy="${state.profileSetupLoading}">
          <fieldset class="role-fieldset" style="border:0;padding:0;margin:0">
            <legend class="role-legend">Account type</legend>
            <div class="role-options">
              ${renderRoleOption('Fan', 'Fan', 'Discover and contribute to artist boards.')}
              ${renderRoleOption('Artist', 'Artist', 'Create your artist board.')}
            </div>
            ${errorFor('role')}
          </fieldset>
          <label class="field-label">Name<input class="field-input" name="name" value="${escapeHTML(state.draft.name)}" autocomplete="name" placeholder="Your display name" aria-invalid="${Boolean(state.errors.name)}" ${state.errors.name ? 'aria-describedby="error-name"' : ''} required>${errorFor('name')}</label>
          <label class="field-label">Username<input class="field-input" name="username" value="${escapeHTML(state.draft.username)}" autocomplete="username" placeholder="Choose a username" aria-invalid="${Boolean(state.errors.username)}" ${state.errors.username ? 'aria-describedby="error-username"' : ''} required>${errorFor('username')}</label>
          <button class="primary-button registration-submit" type="submit" ${state.profileSetupLoading ? 'disabled' : ''}>${state.profileSetupLoading ? 'Saving profile…' : 'Finish setting up'} ${icon('arrow', 15)}</button>
        </form>
      </section>
    </main>
  </div>`;
}

function renderConfirmation() {
  const account = state.accounts.find((entry) => entry.id === state.successAccountId);
  if (!account) return renderWelcome();
  return `<div class="paper-grain landing-page page-enter">
    <header class="landing-header">${brand(false)}<span class="eyebrow">Welcome to Stillroom</span></header>
    <main class="confirmation-layout"><section class="confirmation-card">
      <span class="confirmation-mark">${icon('check', 19)}</span>
      <p class="eyebrow" style="margin-top:23px">You’re in</p>
      <h1 class="confirmation-title">Welcome, ${escapeHTML(account.name)}.</h1>
      <p class="confirmation-copy">Your ${escapeHTML(account.role.toLowerCase())} profile is ready. It’s yours to shape, one thoughtful step at a time.</p>
      <button class="primary-button" type="button" data-action="open-profile" data-testid="button-open-profile">Open your profile ${icon('arrow', 15)}</button>
    </section></main>
  </div>`;
}

function navLink(item, currentRoute) {
  const active = item.path === currentRoute
    || (item.path === '/home' && currentRoute === '/')
    || (item.path === '/home' && currentRoute === '/artists')
    || (item.path === '/home' && currentRoute.startsWith('/artists/'))
    || (item.path === '/artists' && currentRoute.startsWith('/artists/'))
    || (item.path === '/explore' && (currentRoute.startsWith('/board/') || currentRoute.startsWith('/post/')))
    || (item.path === '/shelves' && currentRoute.startsWith('/shelves/'))
    || (item.path === '/profile' && currentRoute.startsWith('/profile/'));
  return `<a class="nav-link" href="${hrefFor(item.path)}" data-route="${item.path}" ${active ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span></a>`;
}

function renderShell(content, pageTitle) {
  const account = activeAccount();
  const nav = navItems.map((item) => navLink(item, state.route)).join('');
  const searchControl = `<button class="icon-button" type="button" data-action="open-search" aria-label="Search artists, boards, and posts">${icon('search', 17)}<span class="search-label">Search</span></button>`;
  const accountControls = account
    ? `<a class="icon-button profile-shortcut" href="${hrefFor('/profile')}" data-route="/profile" aria-label="Open profile">${icon('profile', 17)}<span class="account-handle">@${escapeHTML(account.username)}</span></a><button class="logout-button" type="button" data-action="logout" aria-label="Log out" ${state.authActionLoading ? 'disabled' : ''}>${icon('logout', 15)}<span>${state.authActionLoading ? 'Signing out…' : 'Log out'}</span></button>`
    : `<div class="visitor-join-actions" aria-label="Join Stillroom">
        <a class="outline-button join-nav-button signin-nav-button" href="${hrefFor('/login')}" data-route="/login" data-testid="navigation-sign-in">Sign In</a>
        <button class="primary-button join-nav-button" type="button" data-action="join" data-role="Fan">Join as a Fan</button>
        <button class="outline-button join-nav-button join-nav-artist-button" type="button" data-action="join" data-role="Artist">Join as an Artist</button>
      </div>`;
  return `<div class="paper-grain app-shell">
    <header class="app-topnav">
      <div class="app-topnav-brand">${brand()}</div>
      <nav class="main-nav" aria-label="Main navigation">${nav}</nav>
      <div class="app-nav-actions">${searchControl}${accountControls}</div>
    </header>
    <div class="app-main">
      <header class="topbar"><span class="topbar-title">${escapeHTML(pageTitle)}</span></header>
      <main class="page-content page-enter">${renderAuthNotice()}${content}${renderContentPagination()}</main>
    </div>
    ${renderShelfSignupPrompt()}
    ${renderInteractionPrompt()}
    ${renderShelfPicker()}
  </div>`;
}

function renderEmpty(title, copy = '') {
  return `<div class="empty-state"><div class="empty-state-inner"><span class="empty-icon">${icon('bookmark', 17)}</span><p class="empty-title">${title}</p>${copy ? `<p class="empty-copy">${copy}</p>` : ''}</div></div>`;
}

function renderAccountGate(eyebrow, title, copy) {
  return `<section class="account-gate"><p class="eyebrow">${escapeHTML(eyebrow)}</p><h1 class="page-title">${escapeHTML(title)}</h1><p class="page-subtitle">${escapeHTML(copy)}</p>
    ${renderEmpty('This space is ready for you.', 'Sign in or create a Fan or Artist account to make it yours.')}
    <div class="account-gate-actions"><button class="primary-button" type="button" data-action="join" data-role="Fan">Join as a Fan ${icon('arrow', 14)}</button><button class="outline-button" type="button" data-action="join" data-role="Artist">Join as an Artist</button><a class="quiet-button" href="${hrefFor('/login')}" data-route="/login">Sign in</a></div>
  </section>`;
}

function renderShelfPicker() {
  const postId = state.shelfPickerPostId;
  if (!postId) return '';
  const account = activeAccount();
  const post = state.posts.find((entry) => entry.id === postId && isVisibleFanPost(entry));
  const shelves = state.shelves.filter((shelf) => shelf.ownerId === account?.id && state.shelfPickerScope.includes(shelf.id));
  const preview = post
    ? escapeHTML(post.content?.trim().slice(0, 130) || (post.media?.type === 'video' ? 'Video post' : post.media?.type === 'image' ? 'Image post' : 'Fan post'))
    : 'This post is no longer available.';
  const disabled = state.shelfLoading || state.shelfPickerBusy ? 'disabled' : '';
  const checkboxes = shelves.map((shelf) => `<label class="shelf-picker-option"><input type="checkbox" name="shelfIds" value="${escapeHTML(shelf.id)}" ${state.shelfPickerSelection.includes(shelf.id) ? 'checked' : ''} ${disabled}><span><span class="shelf-picker-title">${escapeHTML(shelf.title)}</span><span class="shelf-picker-visibility">${shelf.visibility === 'public' ? 'Public' : 'Private'}</span></span></label>`).join('');
  return `<div class="shelf-modal-backdrop">
    <section class="shelf-picker" role="dialog" aria-modal="true" aria-labelledby="shelf-picker-title">
      <div class="shelf-picker-head"><div><p class="eyebrow">Keep close</p><h2 class="shelf-picker-heading" id="shelf-picker-title">Add to Shelf</h2></div><button class="icon-button" type="button" data-action="close-shelf-picker" aria-label="Close Shelf picker" ${disabled}>${icon('close', 17)}</button></div>
      <p class="shelf-picker-post">${preview}</p>
      ${state.shelfPickerError ? `<p class="inline-error" role="alert">${escapeHTML(state.shelfPickerError)} <button class="text-button" type="button" data-action="retry-picker-shelves">Try again</button></p>` : ''}
      ${!post ? renderEmpty('Post unavailable.') : shelves.length ? `<form data-form="shelf-picker" data-post-id="${escapeHTML(post.id)}" novalidate ${state.shelfLoading ? 'aria-busy="true"' : ''}>
        <fieldset class="shelf-picker-list"><legend class="shelf-picker-legend">Choose one or more Shelves</legend>${checkboxes}</fieldset>
        ${state.shelfPickerHasMore && state.shelfPickerScope.length < 1000 ? `<button class="text-button" type="button" data-action="more-picker-shelves" ${disabled}>${state.shelfPickerBusy ? 'Loading…' : 'Load More Shelves'}</button>` : ''}
        <div class="shelf-picker-actions"><button class="primary-button" type="submit" ${disabled}>${state.shelfLoading ? `<span class="registration-loading"><span class="loading-dot"></span>Saving…</span>` : `Save to Shelves ${icon('arrow', 14)}`}</button><button class="quiet-button" type="button" data-action="close-shelf-picker" ${disabled}>Cancel</button></div>
      </form>` : state.shelfPickerBusy ? '<p role="status">Loading your Shelves…</p>' : `<div class="shelf-picker-empty">${renderEmpty('You haven’t created a Shelf yet.', 'Create one to save this post for later.') }<button class="primary-button" type="button" data-action="create-shelf-from-picker">Create a Shelf ${icon('arrow', 14)}</button></div>`}
    </section>
  </div>`;
}

function renderInteractionPrompt() {
  if (!state.interactionPrompt) return '';
  return `<div class="shelf-signup-backdrop interaction-backdrop"><section class="shelf-signup-modal interaction-prompt" role="dialog" aria-modal="true" aria-labelledby="interaction-title">
    <button class="shelf-signup-close" type="button" data-action="close-interaction-prompt" aria-label="Close sign-in prompt">${icon('close', 18)}</button>
    <h2 class="shelf-signup-title" id="interaction-title">Make yourself at home.</h2>
    <p class="shelf-signup-description">Sign in or join Stillroom to comment, repost, and save the work that inspires you.</p>
    <div class="shelf-signup-actions"><button class="primary-button" type="button" data-action="interaction-auth" data-destination="login">Sign In</button>
    <button class="outline-button" type="button" data-action="interaction-auth" data-role="Fan">Join as a Fan</button>
    <button class="outline-button" type="button" data-action="interaction-auth" data-role="Artist">Join as an Artist</button></div>
  </section></div>`;
}
function openInteractionPrompt(kind, postId) {
  state.interactionPrompt = { kind, postId };
  render();
  requestAnimationFrame(() => app.querySelector('.interaction-prompt button')?.focus());
}
function closeInteractionPrompt() {
  const prompt = state.interactionPrompt;
  state.interactionPrompt = null;
  render();
  if (prompt?.postId) app.querySelector(`[data-post-id="${prompt.postId}"]`)?.focus();
}
function rememberInteraction(intent) {
  window.sessionStorage.setItem('stillroom.intent', JSON.stringify({ ...intent, expiresAt: Date.now() + 15 * 60 * 1000 }));
}
async function resumeInteraction() {
  const raw = window.sessionStorage.getItem('stillroom.intent');
  window.sessionStorage.removeItem('stillroom.intent');
  let intent;
  try { intent = JSON.parse(raw); } catch { return; }
  if (!intent || !Number.isFinite(intent.expiresAt) || intent.expiresAt < Date.now() || !['comment', 'repost', 'shelf', 'create-shelf'].includes(intent.kind)) return;
  if (intent.kind === 'create-shelf') { navigate('/shelves/new'); return; }
  if (!/^[0-9a-f-]{36}$/i.test(intent.postId || '')) return;
  const generation = authGeneration;
  state.dataLoading = true;
  navigate(`/post/${encodeURIComponent(intent.postId)}`, { refresh: false });
  await refreshPublicContent();
  if (generation !== authGeneration) return;
  state.dataLoading = false;
  const post = state.posts.find((entry) => entry.id === intent.postId);
  if (!post) { render(); return; }
  if (intent.kind === 'comment') {
    if (!state.expandedCommentPostIds.includes(post.id)) state.expandedCommentPostIds.push(post.id);
    render();
    app.querySelector('.comment-textarea')?.focus();
  } else if (intent.kind === 'shelf') openShelfPicker(post.id);
  else if (activeAccount()?.role === 'Fan') toggleRepost(post.id);
  else {
    state.authNotice = { kind: 'error', message: 'Reposting is available to Fan accounts. You can still join the conversation as an Artist.' };
    render();
  }
}

function renderShelfSignupPrompt() {
  if (!state.shelfSignupPromptOpen || state.route !== '/shelves' || activeAccount()) return '';
  return `<div class="shelf-signup-backdrop">
    <section class="shelf-signup-modal" role="dialog" aria-modal="true" aria-labelledby="shelf-signup-title" aria-describedby="shelf-signup-description">
      <button class="shelf-signup-close" type="button" data-action="close-shelf-signup-prompt" data-testid="button-close-shelf-signup-prompt" aria-label="Close sign-up prompt">${icon('close', 18)}</button>
      <span class="shelf-signup-icon" aria-hidden="true">${icon('shelves', 20)}</span>
      <h2 class="shelf-signup-title" id="shelf-signup-title">Join Stillroom to create your first Shelf.</h2>
      <p class="shelf-signup-description" id="shelf-signup-description">Start collecting the art, stories, and moments that inspire you.</p>
      <div class="shelf-signup-actions">
        <button class="outline-button" type="button" data-action="signin-from-shelf-signup-prompt">Sign In</button>
        <button class="primary-button" type="button" data-action="join-from-shelf-signup-prompt" data-role="Fan" data-testid="button-join-as-fan-from-shelf">Join as a Fan</button>
        <button class="outline-button" type="button" data-action="join-from-shelf-signup-prompt" data-role="Artist" data-testid="button-join-as-artist-from-shelf">Join as an Artist</button>
      </div>
    </section>
  </div>`;
}

function openShelfSignupPrompt(focusKey) {
  if (activeAccount() || state.route !== '/shelves') return;
  state.shelfSignupPromptFocusKey = focusKey;
  state.shelfSignupPromptOpen = true;
  render();
  requestAnimationFrame(() => app?.querySelector('[data-action="close-shelf-signup-prompt"]')?.focus());
}

function closeShelfSignupPrompt(restoreFocus = true) {
  if (!state.shelfSignupPromptOpen) return;
  const focusKey = state.shelfSignupPromptFocusKey;
  state.shelfSignupPromptFocusKey = '';
  state.shelfSignupPromptOpen = false;
  render();
  if (restoreFocus && focusKey) {
    requestAnimationFrame(() => {
      const trigger = [...(app?.querySelectorAll('[data-shelf-prompt-focus]') || [])]
        .find((element) => element.dataset.shelfPromptFocus === focusKey);
      trigger?.focus();
    });
  }
}

function renderHome() {
  const selected = state.homeTab === 'for-you';
  const account = activeAccount();
  const followedIds = new Set(followedArtistIds(account?.id || ''));
  const items = homeFeedItems(selected ? null : followedIds);
  const hasFollowedArtists = followedIds.size > 0;
  const tabDescription = selected
    ? 'Fan posts from every Artist Board, newest first.'
    : account?.role === 'Fan'
      ? 'Only posts from Artists you have added to My Artists.'
      : account?.role === 'Artist'
        ? 'A private feed available to Fan accounts.'
        : 'Sign up to build a private feed from the artists you follow.';
  const manageLink = !selected && account
    ? `<a class="home-manage-link" href="${hrefFor('/artists')}" data-route="/artists">${account.role === 'Artist' ? 'Manage my board' : 'Manage My Artists'} ${icon('arrow', 13)}</a>`
    : '';
  const status = account && state.postStatus?.userId === account.id
    ? `<p class="success-banner" role="status">${icon('check', 15)}${escapeHTML(state.postStatus.message)}</p>`
    : '';
  const pendingStatus = state.postPublishing && state.pendingPost?.authorId === account?.id
    ? `<p class="post-saving" role="status">Publishing your post…</p>`
    : '';
  let content;
  if (items.length) {
    content = `<div class="post-list home-feed">${items.map(renderFeedItem).join('')}</div>`;
  } else if (selected) {
    content = `${renderEmpty('Artists make the space. Fans fill it with stories.')}<div class="home-empty-explore"><a class="quiet-button" href="${hrefFor('/explore')}" data-route="/explore">Explore Artists ${icon('arrow', 14)}</a></div>`;
  } else if (!account) {
    content = `${renderEmpty('Join to make this feed yours.', 'Your My Artists feed is private to your account.')}<div class="empty-action"><a class="quiet-button" href="${hrefFor('/login')}" data-route="/login">Sign In</a><button class="quiet-button" type="button" data-action="join" data-role="Fan">Join as Fan ${icon('arrow', 14)}</button></div>`;
  } else if (!hasFollowedArtists) {
    const title = account?.role === 'Fan' ? "You haven't connected with any artists yet." : 'No artists in My Artists yet.';
    const copy = account?.role === 'Fan' ? 'Follow an artist from their board to see posts here.' : 'My Artists is a private list available to Fan accounts.';
    content = `${renderEmpty(title, copy)}${account?.role === 'Fan' ? `<div class="empty-action"><a class="quiet-button" href="${hrefFor('/explore')}" data-route="/explore">Explore artist boards ${icon('arrow', 14)}</a></div>` : ''}`;
  } else {
    content = `${renderEmpty('No posts from your artists yet.', 'When they share something, it will appear here.')}<div class="empty-action"><a class="quiet-button" href="${hrefFor('/explore')}" data-route="/explore">Explore more artists ${icon('arrow', 14)}</a></div>`;
  }
  return `<section class="home-page"><header class="home-intro"><p class="eyebrow">A quieter kind of feed</p><h1 class="page-title">Feed</h1><p class="page-subtitle">A place for work that stays with you.</p></header>
    <div class="home-tab-row"><div class="home-tabs" role="tablist" aria-label="Home feed"><button class="home-tab" type="button" data-action="home-tab" data-tab="for-you" role="tab" aria-selected="${selected}">For You</button><button class="home-tab" type="button" data-action="home-tab" data-tab="my-artists" role="tab" aria-selected="${!selected}">My Artists</button></div>${manageLink}</div><p class="home-tab-context" aria-live="polite">${tabDescription}</p>
    ${status}${pendingStatus}${content}
  </section>`;
}

function boardPortrait(board, large = false) {
  const className = large ? 'board-portrait board-portrait-large' : 'board-portrait';
  if (board.profileImage) {
    return `<img class="${className}" src="${escapeHTML(board.profileImage)}" alt="${escapeHTML(board.artistName)}">`;
  }
  return `<span class="${className} board-portrait-initial" aria-hidden="true">${escapeHTML((board.artistName.trim()[0] || 'A').toUpperCase())}</span>`;
}

function renderBoardCard(board) {
  const route = `/board/${encodeURIComponent(board.id)}`;
  return `<a class="board-card" href="${hrefFor(route)}" data-route="${route}">
    ${boardPortrait(board)}
    <span class="board-card-copy"><span class="board-card-name">${escapeHTML(board.artistName)}</span><span class="board-card-discipline">${escapeHTML(board.discipline)}</span><span class="board-card-bio">${escapeHTML(board.biography)}</span></span>
    ${icon('arrow', 15)}
  </a>`;
}

function renderPostMedia(media, username) {
  if (!media) return '';
  const url = escapeHTML(media.url);
  if (media.type === 'image') {
    return `<div class="post-media"><img src="${url}" alt="Image shared by @${escapeHTML(username)}"></div>`;
  }
  return `<div class="post-media"><video controls preload="metadata" src="${url}" aria-label="Video shared by @${escapeHTML(username)}"></video></div>`;
}

function renderCommentForm(post, comment = null) {
  const account = activeAccount();
  if (!canComment(account)) return '';
  const editing = Boolean(comment);
  const key = editing ? comment.id : commentDraftKey(account.id, post.id);
  const value = editing ? state.commentEditor?.content || '' : state.commentDrafts[key] || '';
  const error = state.commentErrors[key] || '';
  const pending = state.commentPending;
  const disabled = pending || state.commentReaders[post.id] ? 'disabled' : '';
  const isPending = pending?.postId === post.id && pending?.userId === account.id
    && (editing ? pending.commentId === comment.id : pending.action === 'create');
  return `<form class="comment-form" data-form="comment" data-post-id="${escapeHTML(post.id)}" data-comment-id="${escapeHTML(comment?.id || '')}" novalidate ${isPending ? 'aria-busy="true"' : ''}>
    <label class="comment-field-label">${editing ? 'Edit your comment' : 'Add a comment'}<textarea class="field-input field-textarea comment-textarea" name="commentContent" rows="3" maxlength="1000" placeholder="${editing ? 'Edit your comment…' : 'Add to the conversation…'}" aria-invalid="${Boolean(error)}" ${disabled}>${escapeHTML(value)}</textarea></label>
    ${error ? `<p class="inline-error" role="alert">${escapeHTML(error)}</p>` : ''}
    <div class="comment-form-actions"><button class="primary-button" type="submit" ${disabled}>${isPending ? `<span class="registration-loading"><span class="loading-dot"></span>${pending.action === 'edit' ? 'Saving…' : 'Posting…'}</span>` : `${editing ? 'Save comment' : 'Post comment'} ${icon('arrow', 13)}`}</button>${editing ? `<button class="quiet-button" type="button" data-action="cancel-comment-edit" ${disabled}>Cancel</button>` : ''}</div>
  </form>`;
}

function renderCommentItem(comment) {
  const account = activeAccount();
  const isOwner = canComment(account) && account.id === comment.authorId;
  const isEditing = isOwner && state.commentEditor?.commentId === comment.id;
  const isDeleting = isOwner && state.commentDeleteConfirmId === comment.id;
  const pending = state.commentPending?.commentId === comment.id;
  const disabled = state.commentPending ? 'disabled' : '';
  const profileRoute = `/profile/${encodeURIComponent(comment.authorId)}`;
  return `<li class="comment-item">
    <div class="comment-head">${comment.profileImage ? `<img class="comment-avatar" src="${escapeHTML(comment.profileImage)}" alt="" loading="lazy">` : `<span class="comment-avatar comment-avatar-empty" aria-hidden="true">${escapeHTML(comment.authorUsername?.[0]?.toUpperCase() || '')}</span>`}<a class="comment-author" href="${hrefFor(profileRoute)}" data-route="${profileRoute}">@${escapeHTML(comment.authorUsername)}</a><span class="comment-role ${comment.officialArtist ? 'comment-role-official' : ''}" ${comment.officialArtist ? 'title="Official Artist Board owner"' : ''}>${escapeHTML(comment.authorRole || 'Fan')}${comment.officialArtist ? ' · Board owner' : ''}</span><span class="comment-date">${escapeHTML(formatPostDate(comment.createdAt))}${comment.updatedAt ? ' · edited' : ''}</span></div>
    ${isEditing ? renderCommentForm(state.posts.find((post) => post.id === comment.postId), comment) : `<p class="comment-content">${escapeHTML(comment.content)}</p>`}
    ${isOwner && !isEditing ? `<div class="comment-actions">${pending ? `<span class="post-saving" role="status">Updating comment…</span>` : isDeleting ? `<div class="comment-delete-confirm" role="alert"><span>Delete this comment?</span><button class="text-button text-danger" type="button" data-action="confirm-delete-comment" data-comment-id="${escapeHTML(comment.id)}" ${disabled}>Delete</button><button class="text-button" type="button" data-action="cancel-delete-comment" ${disabled}>Cancel</button></div>` : `<button class="text-button" type="button" data-action="edit-comment" data-comment-id="${escapeHTML(comment.id)}" ${disabled}>${icon('edit', 12)} Edit</button><button class="text-button text-danger" type="button" data-action="request-delete-comment" data-comment-id="${escapeHTML(comment.id)}" ${disabled}>${icon('trash', 12)} Delete</button>`}</div>` : ''}
  </li>`;
}

function renderCommentThread(post) {
  const account = activeAccount();
  const expanded = state.expandedCommentPostIds.includes(post.id);
  const comments = state.comments.filter((comment) => comment.postId === post.id)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  const status = state.commentStatus?.postId === post.id && state.commentStatus?.userId === account?.id
    ? `<p class="${state.commentStatus.kind === 'error' ? 'error-banner' : 'success-banner'} comment-status" role="${state.commentStatus.kind === 'error' ? 'alert' : 'status'}">${state.commentStatus.kind === 'success' ? icon('check', 14) : ''}${escapeHTML(state.commentStatus.message)}</p>`
    : '';
  const pending = state.commentPending?.postId === post.id && state.commentPending?.userId === account?.id
    ? `<p class="post-saving" role="status">${state.commentPending.action === 'delete' ? 'Deleting comment…' : state.commentPending.action === 'edit' ? 'Saving comment…' : 'Posting comment…'}</p>`
    : '';
  return `<section class="post-comments">
    <button class="text-button comments-toggle" type="button" data-action="toggle-comments" data-post-id="${escapeHTML(post.id)}" aria-expanded="${expanded}">${expanded ? 'Hide comments' : 'Comments'}</button>
    ${expanded ? `<div class="comment-thread">${status}${pending}
      ${comments.length ? `<ol class="comment-list">${comments.map(renderCommentItem).join('')}</ol>` : `<div class="comment-empty">${renderEmpty('No comments yet.', canComment(account) ? 'Be the first to add a note.' : 'There is nothing to read here yet.')}</div>`}
      ${state.commentReadErrors[post.id] ? `<p class="inline-error" role="alert">${escapeHTML(state.commentReadErrors[post.id])}<button class="text-button" type="button" data-action="retry-comments" data-post-id="${escapeHTML(post.id)}">Try again</button></p>` : ''}
      ${state.commentReaders[post.id] ? '<p role="status">Loading comments…</p>' : state.commentPagination[post.id]?.hasMore ? `<button class="quiet-button" type="button" data-action="earlier-comments" data-post-id="${escapeHTML(post.id)}">Load earlier comments</button>` : ''}
      ${canComment(account) ? renderCommentForm(post) : `<button class="text-button guest-action-link" type="button" data-action="request-comment" data-post-id="${escapeHTML(post.id)}">Sign In / Join to comment ${icon('arrow', 13)}</button>`}
    </div>` : ''}
  </section>`;
}

function renderPostCard(post) {
  const board = state.boards.find((entry) => entry.id === post.boardId);
  if (!board) return '';
  const account = activeAccount();
  const ownsPost = account?.role === 'Fan' && account.id === post.authorId;
  const boardRoute = `/board/${encodeURIComponent(board.id)}`;
  const profileRoute = `/profile/${encodeURIComponent(post.authorId)}`;
  const editDraft = ownsPost ? state.postDrafts[postDraftKey(account.id, board.id, post.id)] : null;
  const deleteConfirmation = ownsPost && state.deleteConfirmPostId === post.id;
  const ownRepost = account?.role === 'Fan' ? state.reposts.find((entry) => entry.userId === account.id && entry.postId === post.id) : null;
  const repostConfirmation = state.repostConfirm?.postId === post.id && state.repostConfirm?.userId === account?.id;
  const repostPending = state.repostPending?.postId === post.id && state.repostPending?.userId === account?.id;
  const postMutationPending = state.commentPending?.postId === post.id || state.repostPending?.postId === post.id;
  const repostStatus = state.repostStatus?.postId === post.id && state.repostStatus?.userId === account?.id
    ? `<p class="${state.repostStatus.kind === 'error' ? 'error-banner' : 'success-banner'} repost-status" role="${state.repostStatus.kind === 'error' ? 'alert' : 'status'}">${state.repostStatus.kind === 'success' ? icon('check', 14) : ''}${escapeHTML(state.repostStatus.message)}</p>`
    : '';
  const shelfStatus = state.shelfStatus?.ownerId === account?.id && state.shelfStatus?.postId === post.id
    ? `<p class="shelf-post-status" role="status">${icon('check', 13)}${escapeHTML(state.shelfStatus.message)}</p>`
    : '';
  return `<article class="post-card" id="post-card-${escapeHTML(post.id)}">
    <div class="post-card-heading">
      <div class="post-author"><span class="post-avatar" aria-hidden="true">${escapeHTML((post.authorUsername[0] || 'F').toUpperCase())}</span><span><a class="post-author-name" href="${hrefFor(profileRoute)}" data-route="${profileRoute}">@${escapeHTML(post.authorUsername)}</a><span class="post-date">Published ${escapeHTML(formatPostDate(post.publishedAt))}</span></span></div>
      <span class="post-board-context">On <a class="post-board-link" href="${hrefFor(boardRoute)}" data-route="${boardRoute}">${escapeHTML(board.artistName)}</a>’s board ${icon('arrow', 12)}</span>
    </div>
    ${post.content ? `<p class="post-content">${escapeHTML(post.content)}</p>` : ''}
    ${renderPostMedia(post.media, post.authorUsername)}
    ${shelfStatus}
    ${ownsPost && editDraft ? `<div class="post-draft-inline"><span>Unpublished edits available.</span><div><button class="text-button" type="button" data-action="resume-post-draft" data-board-id="${escapeHTML(board.id)}" data-post-id="${escapeHTML(post.id)}">Resume editing</button><button class="text-button text-danger" type="button" data-action="discard-saved-post-draft" data-board-id="${escapeHTML(board.id)}" data-post-id="${escapeHTML(post.id)}">Discard draft</button></div></div>` : ''}
    <div class="post-actions">
      <button class="text-button shelf-save-button" type="button" data-action="open-shelf-picker" data-post-id="${escapeHTML(post.id)}" ${state.shelfLoading ? 'disabled' : ''}>${icon('bookmark', 13)} Add to Shelf</button>
      ${account?.role === 'Fan' ? `<button class="text-button repost-button" type="button" data-action="toggle-repost" data-post-id="${escapeHTML(post.id)}" ${state.repostPending ? 'disabled' : ''}>${icon('repost', 13)} ${ownRepost ? 'Undo repost' : 'Repost'}</button>` : ''}
      ${!account ? `<button class="text-button repost-button" type="button" data-action="toggle-repost" data-post-id="${escapeHTML(post.id)}">${icon('repost', 13)} Repost</button>` : ''}
      ${ownsPost ? (state.postPublishing
        ? `<span class="post-saving" role="status">${state.pendingPost?.postId === post.id ? 'Saving changes…' : 'Please wait for the post to finish publishing…'}</span>`
        : deleteConfirmation
        ? `<div class="post-delete-confirm" role="alert"><span>Delete this post?</span><button class="text-button text-danger" type="button" data-action="confirm-delete-post" data-post-id="${escapeHTML(post.id)}" ${postMutationPending ? 'disabled' : ''}>Delete</button><button class="text-button" type="button" data-action="cancel-delete-post" ${postMutationPending ? 'disabled' : ''}>Cancel</button></div>`
        : `<button class="text-button" type="button" data-action="edit-post" data-board-id="${escapeHTML(board.id)}" data-post-id="${escapeHTML(post.id)}" ${postMutationPending ? 'disabled' : ''}>${icon('edit', 13)} Edit</button><button class="text-button text-danger" type="button" data-action="request-delete-post" data-post-id="${escapeHTML(post.id)}" ${postMutationPending ? 'disabled' : ''}>${icon('trash', 13)} Delete</button>`) : ''}
    </div>
    ${repostConfirmation ? `<div class="repost-confirm" role="alert"><span>${state.repostConfirm.action === 'undo' ? 'Undo your repost?' : 'Repost this to your profile?'}</span><button class="text-button text-danger" type="button" data-action="confirm-repost" data-post-id="${escapeHTML(post.id)}">Confirm</button><button class="text-button" type="button" data-action="cancel-repost">Cancel</button></div>` : ''}
    ${repostPending ? `<p class="post-saving repost-pending" role="status">${state.repostPending.action === 'undo' ? 'Undoing your repost…' : 'Reposting…'}</p>` : ''}
    ${repostStatus}
    ${renderCommentThread(post)}
  </article>`;
}

function renderFeedItem(item) {
  if (item.type !== 'repost') return renderPostCard(item.post);
  const reposter = state.accounts.find((account) => account.id === item.repost.userId);
  if (!reposter) return '';
  const profileRoute = `/profile/${encodeURIComponent(reposter.id)}`;
  return `<div class="repost-feed-item"><p class="repost-credit">${icon('repost', 13)} <a href="${hrefFor(profileRoute)}" data-route="${profileRoute}">@${escapeHTML(reposter.username)}</a> reposted</p>${renderPostCard(item.post)}</div>`;
}

function renderPostForm(board, editor, draft) {
  const editing = Boolean(editor.postId);
  const error = state.postErrors[editor.key] || '';
  const disabled = state.postPublishing || state.postMediaLoading ? 'disabled' : '';
  const mediaPreview = draft.media
    ? `<div class="post-draft-media">${renderPostMedia(draft.media, activeAccount()?.username || '')}<div class="post-draft-media-info"><span>${draft.media.type === 'image' ? 'Image' : 'Video'} attached${draft.media.name ? ` · ${escapeHTML(draft.media.name)}` : ''}</span><button class="text-button text-danger" type="button" data-action="remove-post-media" ${disabled}>Remove media</button></div></div>`
    : '';
  return `<div class="post-composer">
    <p class="eyebrow">${editing ? 'Edit your post' : 'Add to the conversation'}</p>
    <form data-form="post" data-board-id="${escapeHTML(board.id)}" data-post-id="${escapeHTML(editor.postId || '')}" novalidate ${state.postPublishing ? 'aria-busy="true"' : ''}>
      <label class="field-label">Your post<textarea class="field-input field-textarea post-textarea" name="postContent" rows="5" maxlength="2000" placeholder="Share something with this artist’s community" aria-invalid="${Boolean(error)}" data-post-content ${disabled}>${escapeHTML(draft.content)}</textarea></label>
      ${error ? `<p class="inline-error" data-post-error role="alert">${escapeHTML(error)}</p>` : ''}
      <label class="field-label post-upload-label">Add an image or video <span class="optional-label">(optional)</span><input class="file-input" type="file" data-post-media accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" ${disabled}><span class="field-hint">Images up to 10 MB; MP4 or WebM videos up to 25 MB.</span></label>
      ${state.postMediaLoading ? `<p class="field-hint" role="status"><span data-post-upload-label>${state.postUploadProgress === 100 ? 'Verifying upload…' : `Uploading media securely… ${state.postUploadProgress}%`}</span><progress data-post-upload-progress aria-label="Media upload progress" max="100" value="${state.postUploadProgress}"></progress></p>` : ''}
      ${mediaPreview}
      <div class="post-form-actions">
        <button class="primary-button" type="submit" ${disabled}>${state.postPublishing ? `<span class="registration-loading"><span class="loading-dot"></span>${editing ? 'Saving…' : 'Publishing…'}</span>` : `${editing ? 'Save changes' : 'Publish post'} ${icon('arrow', 14)}`}</button>
        <button class="quiet-button" type="button" data-action="save-post-draft" ${disabled}>Save draft</button>
        <button class="text-button" type="button" data-action="discard-current-post-draft" ${disabled}>${editing ? 'Discard changes' : 'Discard draft'}</button>
      </div>
    </form>
  </div>`;
}

function renderBoardComposer(board) {
  const account = activeAccount();
  if (!account) return `<div class="post-create-trigger"><button class="primary-button" type="button" data-action="join" data-role="Fan">${icon('plus', 15)} Join as Fan to write a post</button></div>`;
  if (account.role !== 'Fan') return '';
  const editor = state.postEditor;
  if (editor?.boardId === board.id && editor.authorId === account.id) {
    return renderPostForm(board, editor, state.postDrafts[editor.key]);
  }
  if (state.postPublishing) {
    return `<p class="post-saving" role="status">Publishing your post…</p>`;
  }
  const draft = state.postDrafts[postDraftKey(account.id, board.id)];
  if (draft) {
    return `<div class="saved-post-draft"><div><p class="draft-label">Draft</p><p class="draft-copy">${draft.content ? escapeHTML(draft.content.slice(0, 140)) : draft.media ? `${draft.media.type === 'image' ? 'Image' : 'Video'} attached` : 'An empty draft'}</p></div><button class="quiet-button" type="button" data-action="resume-post-draft" data-board-id="${escapeHTML(board.id)}">Continue draft ${icon('arrow', 14)}</button><button class="text-button text-danger" type="button" data-action="discard-saved-post-draft" data-board-id="${escapeHTML(board.id)}">Discard</button></div>`;
  }
  return `<div class="post-create-trigger"><button class="primary-button" type="button" data-action="start-post" data-board-id="${escapeHTML(board.id)}">${icon('plus', 15)} Write a post</button></div>`;
}

function renderExploreArtist(account) {
  const board = boardForOwner(account.id);
  const route = `/profile/${encodeURIComponent(account.id)}`;
  const discipline = board?.discipline || 'Artist';
  return `<a class="explore-artist-result" href="${hrefFor(route)}" data-route="${route}">
    <span class="explore-artist-mark" aria-hidden="true">${escapeHTML((account.name.trim()[0] || account.username[0] || 'A').toUpperCase())}</span>
    <span class="explore-artist-copy"><span class="explore-artist-name">${escapeHTML(board?.artistName || account.name)}</span><span class="explore-artist-meta">@${escapeHTML(account.username)} · ${escapeHTML(discipline)}</span></span>
    ${icon('arrow', 15)}
  </a>`;
}

function renderExplorePost(post) {
  const board = state.boards.find((entry) => entry.id === post.boardId);
  const author = state.accounts.find((entry) => entry.id === post.authorId);
  if (!board || !author) return '';
  const route = `/post/${encodeURIComponent(post.id)}`;
  const title = post.title || post.artworkTitle || (post.media?.name ? post.media.name.replace(/\.[^.]+$/, '') : '');
  const excerpt = post.content?.trim() || (post.media?.type === 'video' ? 'Video post' : post.media?.type === 'image' ? 'Image post' : 'Fan post');
  return `<a class="explore-post-result" href="${hrefFor(route)}" data-route="${route}">
    <span class="explore-post-kicker">${escapeHTML(board.discipline)} · ${escapeHTML(formatPostDate(post.publishedAt))}</span>
    <span class="explore-post-title">${escapeHTML(title || excerpt.slice(0, 92))}</span>
    ${title && post.content ? `<span class="explore-post-excerpt">${escapeHTML(excerpt.slice(0, 150))}</span>` : ''}
    <span class="explore-post-credit">By @${escapeHTML(author.username)} · On ${escapeHTML(board.artistName)}’s board</span>
    ${icon('arrow', 15)}
  </a>`;
}

function renderExploreError() {
  return `<div class="explore-feedback explore-error" role="alert"><p class="explore-feedback-title">Explore couldn’t load these results.</p><p class="explore-feedback-copy">Your saved content has not changed. Try again or reset your search.</p><button class="quiet-button" type="button" data-action="retry-explore">Try again</button><button class="text-button" type="button" data-action="reset-explore">Reset search and filters</button></div>`;
}

function renderExploreResults() {
  if (state.exploreError) return renderExploreError();
  if (state.exploreLoading || (state.contentRefreshing && !state.contentCursor)) {
    return `<div class="explore-feedback explore-loading" role="status" aria-live="polite"><span class="loading-dot"></span>Searching your Stillroom…</div>`;
  }
  const { artists, boards, posts } = exploreResults();
  const total = artists.length + boards.length + posts.length;
  if (!total) {
    const hasCriteria = state.exploreQuery.trim() || state.exploreDiscipline !== 'all';
    if (!hasCriteria) return renderEmpty('Nothing to discover yet.', 'Artist profiles, boards, and Fan posts will appear here when they’re created.');
    return `<div class="explore-no-results">${renderEmpty('No results found.', 'Try another search or clear the selected category.')}<div class="empty-action"><button class="quiet-button" type="button" data-action="reset-explore">Reset search and filters</button></div></div>`;
  }

  const countLine = `${artists.length} ${artists.length === 1 ? 'artist' : 'artists'} · ${boards.length} ${boards.length === 1 ? 'board' : 'boards'} · ${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`;
  return `<p class="explore-result-count" role="status">Loaded: ${countLine}</p>
    ${artists.length ? `<section class="explore-result-section"><h2 class="section-heading">Artists</h2><div class="explore-artist-list">${artists.map(renderExploreArtist).join('')}</div></section>` : ''}
    ${boards.length ? `<section class="explore-result-section"><h2 class="section-heading">${state.exploreQuery.trim() || state.exploreDiscipline !== 'all' ? 'Artist Boards' : 'Recently created boards'}</h2><div class="board-grid">${boards.map(renderBoardCard).join('')}</div></section>` : ''}
    ${posts.length ? `<section class="explore-result-section"><h2 class="section-heading">${state.exploreQuery.trim() || state.exploreDiscipline !== 'all' ? 'Fan Posts' : 'Recent posts'}</h2><div class="explore-post-list">${posts.map(renderExplorePost).join('')}</div></section>` : ''}`;
}

function queueExploreSearch() {
  if (state.exploreTimer) window.clearTimeout(state.exploreTimer);
  state.exploreError = '';
  state.exploreLoading = true;
  const results = app.querySelector('#explore-results');
  if (results) {
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = renderExploreResults();
  }
  state.exploreTimer = window.setTimeout(() => {
    state.exploreTimer = null;
    state.exploreLoading = false;
    state.contentPage = 0;
    state.contentCursor = null;
    void refreshPublicContent();
    try {
      const latestResults = app.querySelector('#explore-results');
      if (latestResults) {
        latestResults.removeAttribute('aria-busy');
        latestResults.innerHTML = renderExploreResults();
      }
    } catch {
      state.exploreError = 'search-failed';
      const latestResults = app.querySelector('#explore-results');
      if (latestResults) {
        latestResults.removeAttribute('aria-busy');
        latestResults.innerHTML = renderExploreResults();
      }
    }
  }, 140);
}

function resetExplore() {
  if (state.exploreTimer) window.clearTimeout(state.exploreTimer);
  state.exploreTimer = null;
  state.exploreQuery = '';
  state.exploreDiscipline = 'all';
  state.exploreLoading = false;
  state.exploreError = '';
  state.contentPage = 0;
  state.contentCursor = null;
  render();
  void refreshPublicContent();
}

function renderExplore() {
  const disciplines = ['all', ...exploreDisciplines, 'Other'];
  return `<section><p class="eyebrow">Find your next room</p><h1 class="page-title">Explore</h1><p class="page-subtitle">Search artists, boards, and Fan posts by name, username, title, or keywords.</p>
    <div class="explore-controls">
      <label class="explore-search">${icon('search', 16)}<input type="search" data-explore-search aria-label="Search artists, boards, and posts" placeholder="Search names, titles, or keywords" value="${escapeHTML(state.exploreQuery)}"><button class="icon-button" type="button" data-action="clear-explore-search" aria-label="Clear search" ${state.exploreQuery ? '' : 'hidden'}>${icon('close', 15)}</button></label>
      <label class="explore-discipline-label"><span class="eyebrow">Categories</span><select class="explore-discipline" data-explore-discipline aria-label="Filter by categories">${disciplines.map((discipline) => `<option value="${discipline === 'all' ? 'all' : escapeHTML(discipline)}" ${state.exploreDiscipline === (discipline === 'all' ? 'all' : discipline) ? 'selected' : ''}>${discipline === 'all' ? 'All Categories' : escapeHTML(discipline)}</option>`).join('')}</select></label>
    </div>
    <div id="explore-results" aria-live="polite">${renderExploreResults()}</div>
  </section>`;
}

function renderFollowedBoard(board) {
  return `<div class="followed-board-row">${renderBoardCard(board)}<button class="text-button text-danger" type="button" data-action="toggle-artist-follow" data-board-id="${escapeHTML(board.id)}" aria-pressed="true">Remove from My Artists</button></div>`;
}

function renderArtists() {
  const account = activeAccount();
  if (!account) {
    return renderAccountGate('Your artist space', 'My Artists', 'Connect with artists and manage your Artist Board after joining Stillroom.');
  }
  if (account?.role === 'Fan') {
    const followed = new Set(followedArtistIds(account.id));
    const boards = state.boards.filter((board) => followed.has(board.ownerId));
    const status = state.followStatus?.userId === account.id
      ? `<p class="success-banner" role="status">${icon('check', 15)}${escapeHTML(state.followStatus.message)}</p>`
      : '';
    if (!boards.length) {
      return `<section><p class="eyebrow">The rooms you return to</p><h1 class="page-title">My Artists</h1><p class="page-subtitle">A private list of artists you choose to follow.</p>${status}${renderEmpty("You haven't connected with any artists yet.", 'Visit an artist board to add them here.')}<div class="empty-action"><a class="quiet-button" href="${hrefFor('/explore')}" data-route="/explore">Explore artist boards ${icon('arrow', 14)}</a></div></section>`;
    }
    return `<section><p class="eyebrow">The rooms you return to</p><h1 class="page-title">My Artists</h1><p class="page-subtitle">A private list of artists you choose to follow.</p>${status}<div class="followed-board-list">${boards.map(renderFollowedBoard).join('')}</div></section>`;
  }
  if (account?.role !== 'Artist') {
    return `<section><p class="eyebrow">The rooms you return to</p><h1 class="page-title">My Artists</h1><p class="page-subtitle">The artists you choose to keep close.</p>${renderEmpty("You haven't added any artists to My Artists yet.")}<div class="empty-action"><a class="quiet-button" href="${hrefFor('/explore')}" data-route="/explore">Explore artist boards ${icon('arrow', 14)}</a></div></section>`;
  }

  const board = boardForOwner(account.id);
  if (!board) {
    return `<section><p class="eyebrow">Your artist space</p><h1 class="page-title">My Artists</h1><p class="page-subtitle">Create your personal board so fans can find your work.</p>
      <div class="empty-state"><div class="empty-state-inner"><span class="empty-icon">${icon('image', 17)}</span><p class="empty-title">You don’t have a board yet.</p><p class="empty-copy">Create one personal board for your name, discipline, and biography.</p><button class="primary-button empty-cta" type="button" data-action="create-board">Create your board ${icon('arrow', 14)}</button></div></div>
    </section>`;
  }

  return `<section><p class="eyebrow">Your artist space</p><div class="page-heading-row"><div><h1 class="page-title">My Artists</h1><p class="page-subtitle">Your personal artist board.</p></div><button class="quiet-button" type="button" data-action="edit-own-board">${icon('edit', 15)} Edit board</button></div>
    ${state.boardSuccessId === board.id ? `<p class="success-banner" role="status">${icon('check', 15)}${escapeHTML(state.boardSuccess)}</p>` : ''}
    <div class="owned-board-card">${renderBoardCard(board)}<span class="owned-board-empty">Your public board is ready for fan contributions.</span></div>
  </section>`;
}

function boardFieldError(field) {
  return state.boardErrors[field] ? `<span class="field-error" id="board-error-${field}" role="alert">${escapeHTML(state.boardErrors[field])}</span>` : '';
}

function boardDraftFrom(existing, account = null) {
  return existing
    ? { artistName: existing.artistName, discipline: existing.discipline, biography: existing.biography,
      profileImage: existing.profileImage || '', profileImageAssetId: existing.profileImageAssetId || null,
      coverImage: existing.coverImage || '', coverImageAssetId: existing.coverImageAssetId || null,
      creativeDescription: existing.creativeDescription || '' }
    : { artistName: account?.name || '', discipline: '', biography: '', profileImage: '', profileImageAssetId: null,
      coverImage: '', coverImageAssetId: null, creativeDescription: '' };
}

function renderBoardForm(mode) {
  const account = activeAccount();
  const existing = account?.role === 'Artist' ? boardForOwner(account.id) : null;
  if (!account) {
    return renderAccountGate('Artist board', 'Create an Artist Board', 'Join as an Artist to create and manage your personal board.');
  }
  if (account.role !== 'Artist') {
    return `<section><p class="eyebrow">Artist board</p><h1 class="page-title">Artists only</h1><p class="page-subtitle">Only Artist accounts can create or edit artist boards.</p>${renderEmpty('This action isn’t available for your account type.')}<div class="empty-action"><a class="quiet-button" href="${hrefFor('/artists')}" data-route="/artists">Back to My Artists</a></div></section>`;
  }
  if (mode === 'create' && existing) {
    return `<section><p class="eyebrow">One personal board</p><h1 class="page-title">Your board already exists.</h1><p class="page-subtitle">Each Artist account can have one personal board.</p><div class="empty-action"><a class="primary-button" href="${hrefFor(`/board/${encodeURIComponent(existing.id)}`)}" data-route="/board/${encodeURIComponent(existing.id)}">View your board ${icon('arrow', 14)}</a></div></section>`;
  }
  if (mode === 'edit' && !existing) {
    return `<section><p class="eyebrow">Artist board</p><h1 class="page-title">No board to edit yet.</h1><p class="page-subtitle">Create your personal board first.</p><div class="empty-action"><button class="primary-button" type="button" data-action="create-board">Create your board ${icon('arrow', 14)}</button></div></section>`;
  }

  if (!state.boardDraft) {
    state.boardDraft = existing
      ? boardDraftFrom(existing)
      : boardDraftFrom(null, account);
  }
  const draft = state.boardDraft;
  const editing = mode === 'edit';
  const disabled = state.boardLoading || state.usernameLoading ? 'disabled' : '';
  const saveDisabled = state.boardLoading || state.boardImageLoading || state.boardCoverLoading || state.usernameLoading ? 'disabled' : '';
  const creative = draft.creativeDescription || '';
  const imagePreview = draft.profileImage
    ? `<div class="board-image-preview"><img src="${escapeHTML(draft.profileImage)}" alt="Selected profile image"><div><p class="preview-title">Profile image selected</p><button class="text-button" type="button" data-action="remove-board-image">Remove image</button></div></div>`
    : '';
  return `<section><p class="eyebrow">${editing ? 'Your artist space' : 'Make it yours'}</p><h1 class="page-title">${editing ? 'Edit your board' : 'Create your board'}</h1><p class="page-subtitle">Your board is a quiet introduction. It starts empty, with no posts.</p>
    <div class="board-form-card">
      ${state.boardErrors.form ? `<p class="inline-error" role="alert">${escapeHTML(state.boardErrors.form)}</p>` : ''}
      <form data-form="board" data-mode="${mode}" novalidate ${state.boardLoading || state.boardImageLoading || state.usernameLoading ? 'aria-busy="true"' : ''}>
        <label class="field-label">Artist name<input class="field-input" name="artistName" value="${escapeHTML(draft.artistName)}" placeholder="The name fans will see" aria-invalid="${Boolean(state.boardErrors.artistName)}" ${state.boardErrors.artistName ? 'aria-describedby="board-error-artistName"' : ''} ${disabled} required>${boardFieldError('artistName')}</label>
        <label class="field-label">Artistic discipline<input class="field-input" name="discipline" value="${escapeHTML(draft.discipline)}" placeholder="Music, film, photography…" aria-invalid="${Boolean(state.boardErrors.discipline)}" ${state.boardErrors.discipline ? 'aria-describedby="board-error-discipline"' : ''} ${disabled} required>${boardFieldError('discipline')}</label>
        <label class="field-label">Biography<textarea class="field-input field-textarea" name="biography" rows="5" maxlength="800" placeholder="A few words about your practice and work" aria-invalid="${Boolean(state.boardErrors.biography)}" ${state.boardErrors.biography ? 'aria-describedby="board-error-biography"' : ''} ${disabled} required>${escapeHTML(draft.biography)}</textarea>${boardFieldError('biography')}</label>
        <label class="field-label">Profile image <span class="optional-label">(optional)</span><input class="file-input" name="profileImage" type="file" accept="image/png,image/jpeg,image/webp" data-board-image ${disabled}><span class="field-hint">PNG, JPG, or WebP. Maximum 4 MB.</span></label>
        ${state.boardImageLoading ? `<p class="field-hint" role="status">Preparing image…</p>` : ''}
        ${state.boardImageError ? `<p class="inline-error" role="alert">${escapeHTML(state.boardImageError)}</p>` : ''}
        ${imagePreview}
        <label class="field-label">Short creative description <span class="optional-label">(optional)</span><input class="field-input" name="creativeDescription" maxlength="240" value="${escapeHTML(creative)}" placeholder="One line on the work you make" aria-invalid="${Boolean(state.boardErrors.creativeDescription)}" aria-describedby="board-creative-count${state.boardErrors.creativeDescription ? ' board-error-creativeDescription' : ''}" ${disabled} data-testid="input-creative-description"><span class="field-hint" id="board-creative-count">${creative.length} / 240</span>${boardFieldError('creativeDescription')}</label>
        <label class="field-label">Cover image <span class="optional-label">(optional)</span><input class="file-input" name="coverImage" type="file" accept="image/png,image/jpeg,image/webp" data-board-cover ${disabled || (state.boardCoverLoading ? 'disabled' : '')} data-testid="input-cover-image"><span class="field-hint">A wide banner for the top of your board. PNG, JPG, or WebP. Maximum 4 MB.</span></label>
        ${state.boardCoverLoading ? `<p class="field-hint" role="status">Uploading cover image…</p>` : ''}
        ${state.boardCoverError ? `<p class="inline-error" role="alert">${escapeHTML(state.boardCoverError)}</p>` : ''}
        ${draft.coverImage ? `<div class="board-cover-preview"><img src="${escapeHTML(draft.coverImage)}" alt="Selected cover image"><div><p class="preview-title">${state.boardCoverLoading ? 'Uploading cover…' : 'Cover image selected'}</p><button class="text-button" type="button" data-action="remove-board-cover" ${disabled}>${state.boardCoverLoading ? 'Cancel upload' : 'Remove cover'}</button></div></div>` : ''}
        <div class="board-form-footer"><button class="primary-button" type="submit" ${saveDisabled} data-testid="button-save-board">${state.boardLoading ? `<span class="registration-loading"><span class="loading-dot"></span>${editing ? 'Saving…' : 'Creating…'}</span>` : state.boardImageLoading || state.boardCoverLoading ? 'Preparing image…' : `${editing ? 'Save changes' : 'Create board'} ${icon('arrow', 14)}`}</button><button class="quiet-button" type="button" data-action="cancel-board-form" ${disabled}>Cancel</button></div>
      </form>
    </div>
    ${editing ? renderUsernameChange(account) : ''}
  </section>`;
}

function renderBoardDetail(boardId, collectionId = null) {
  const board = state.boards.find((entry) => entry.id === boardId);
  if (!board) {
    return `<section><p class="eyebrow">Artist board</p><h1 class="page-title">Board not found.</h1><p class="page-subtitle">This board isn’t available in this session.</p>${renderEmpty('No board found.') }<div class="empty-action"><a class="quiet-button" href="${hrefFor('/explore')}" data-route="/explore">Back to Explore ${icon('arrow', 14)}</a></div></section>`;
  }
  if (collectionId) return `${curation.renderCollectionDetail(board, collectionId)}${curation.renderPicker()}`;
  const owner = activeAccount()?.role === 'Artist' && activeAccount()?.id === board.ownerId && !curation.isPreview();
  const account = activeAccount();
  const ownerAccount = state.accounts.find((account) => account.id === board.ownerId);
  const ownerProfileRoute = `/profile/${encodeURIComponent(board.ownerId)}`;
  const username = ownerAccount ? `<a href="${hrefFor(ownerProfileRoute)}" data-route="${ownerProfileRoute}">@${escapeHTML(ownerAccount.username)}</a>` : '';
  const following = account?.role === 'Fan' && isFollowingArtist(account.id, board.ownerId);
  const onBoardRoute = Boolean(parseBoardRoute(state.route));
  const posts = chronologicalPosts(onBoardRoute ? curation.boardPagePosts(board) : state.posts.filter((post) => post.boardId === board.id));
  const postStatus = state.postStatus?.boardId === board.id && state.postStatus?.userId === account?.id
    ? `<p class="success-banner" role="status">${icon('check', 15)}${escapeHTML(state.postStatus.message)}</p>`
    : '';
  const followStatus = state.followStatus?.boardId === board.id && state.followStatus?.userId === account?.id
    ? `<p class="success-banner" role="status">${icon('check', 15)}${escapeHTML(state.followStatus.message)}</p>`
    : '';
  return `<section><p class="eyebrow">Artist board</p>
    ${owner && state.boardSuccessId === board.id ? `<p class="success-banner" role="status">${icon('check', 15)}${escapeHTML(state.boardSuccess)}</p>` : ''}
    ${board.coverImage ? `<figure class="board-cover"><img src="${escapeHTML(board.coverImage)}" alt="Cover image for ${escapeHTML(board.artistName)}’s board"></figure>` : ''}
    <div class="board-detail ${board.coverImage ? 'has-cover' : ''}">
      ${boardPortrait(board, true)}
      <div class="board-detail-copy"><span class="board-card-discipline">${escapeHTML(board.discipline)}</span><h1 class="page-title">${escapeHTML(board.artistName)}</h1><p class="board-owner-handle">${username}</p>${board.creativeDescription ? `<p class="board-creative-description">${escapeHTML(board.creativeDescription)}</p>` : ''}<p class="board-biography">${escapeHTML(board.biography)}</p>
        ${owner ? `<button class="quiet-button board-edit-button" type="button" data-action="edit-own-board">${icon('edit', 15)} Edit board information</button>` : ''}
        ${account?.role === 'Fan' ? `<button class="quiet-button board-follow-button" type="button" data-action="toggle-artist-follow" data-board-id="${escapeHTML(board.id)}" aria-pressed="${following}">${following ? 'Remove from My Artists' : 'Add to My Artists'}</button>` : ''}
      </div>
    </div>
    ${followStatus}${postStatus}
    ${onBoardRoute ? curation.renderBoardSections(board) : ''}
    <h2 class="section-heading all-posts-heading">All Fan Posts</h2>
    ${renderBoardComposer(board)}
    ${posts.length ? `<div class="post-list board-post-list">${posts.map((post) => (onBoardRoute ? curation.renderBoardPost(board, post) : renderPostCard(post))).join('')}</div>` : `<div class="board-content-empty">${renderEmpty('This board is empty.', 'There are no posts here yet.')}</div>`}
  </section>${curation.renderPicker()}`;
}

function renderShelfCover(shelf, size) {
  if (!shelf.cover?.url) return icon('bookmark', size);
  return shelf.cover.type === 'video'
    ? `<video class="shelf-cover-media" src="${escapeHTML(shelf.cover.url)}" muted playsinline preload="metadata" aria-label="Saved video preview"></video>`
    : `<img class="shelf-cover-media" src="${escapeHTML(shelf.cover.url)}" alt="" loading="lazy">`;
}
function renderShelfCard(shelf) {
  const route = `/shelves/${encodeURIComponent(shelf.id)}`;
  return `<a class="shelf-card" href="${hrefFor(route)}" data-route="${route}">
    <span class="shelf-card-mark">${renderShelfCover(shelf, 17)}</span>
    <span class="shelf-card-copy"><span class="shelf-card-title">${escapeHTML(shelf.title)}</span>${shelf.description ? `<span class="shelf-card-description">${escapeHTML(shelf.description)}</span>` : ''}</span>
    <span class="shelf-visibility shelf-visibility-${shelf.visibility}">${shelf.visibility === 'public' ? 'Public' : 'Private'}</span>
    ${icon('arrow', 14)}
  </a>`;
}

function renderMySpaceShelfCard(shelf) {
  const route = `/shelves/${encodeURIComponent(shelf.id)}`;
  return `<a class="my-space-shelf-card" href="${hrefFor(route)}" data-route="${route}">
    <span class="my-space-shelf-cover" aria-hidden="true">${renderShelfCover(shelf, 25)}</span>
    <span class="my-space-shelf-info"><span class="shelf-visibility shelf-visibility-${shelf.visibility}">${shelf.visibility === 'public' ? 'Public' : 'Private'}</span><span class="my-space-shelf-title">${escapeHTML(shelf.title)}</span>${shelf.description ? `<span class="my-space-shelf-description">${escapeHTML(shelf.description)}</span>` : ''}<span class="my-space-shelf-count">${shelf.savedCount ?? shelf.postIds.length} ${(shelf.savedCount ?? shelf.postIds.length) === 1 ? 'saved post' : 'saved posts'}</span></span>
    ${icon('arrow', 15)}
  </a>`;
}

function renderShelfPreviewCard(number) {
  return `<button class="shelf-preview-card" type="button" data-action="open-shelf-signup-prompt" data-shelf-prompt-focus="shelf-${number}" data-testid="button-open-shelf-preview-${number}" aria-label="Shelf ${number} preview. Join Stillroom to create your first Shelf.">
    <span class="shelf-preview-cover" aria-hidden="true"><span class="shelf-preview-art">${icon('sparkle', 27)}</span></span>
    <span class="shelf-preview-caption"><span class="shelf-preview-title">Shelf ${number}</span><span class="shelf-preview-tag">Layout preview</span></span>
  </button>`;
}

function renderPublicShelves(ownerId, heading = 'Public Shelves') {
  const shelves = state.shelves.filter((shelf) => shelf.ownerId === ownerId && shelf.visibility === 'public');
  return `<section class="profile-shelves"><div class="section-heading-row"><h2 class="section-heading">${heading}</h2>${activeAccount()?.id === ownerId ? `<a class="text-link" href="${hrefFor('/shelves')}" data-route="/shelves">Manage Shelves ${icon('arrow', 13)}</a>` : ''}</div>
    ${shelves.length ? `<div class="shelf-grid">${shelves.map(renderShelfCard).join('')}</div>` : renderEmpty('No public Shelves yet.')}
  </section>`;
}

function renderShelves() {
  const account = activeAccount();
  const shelves = account ? state.shelves.filter((shelf) => shelf.ownerId === account.id) : [];
  const status = account && state.shelfStatus?.ownerId === account.id && !state.shelfStatus?.shelfId && !state.shelfStatus?.postId
    ? `<p class="success-banner ${state.shelfStatus.kind === 'error' ? 'shelf-error-banner' : ''}" role="${state.shelfStatus.kind === 'error' ? 'alert' : 'status'}">${state.shelfStatus.kind === 'error' ? icon('close', 15) : icon('check', 15)}${escapeHTML(state.shelfStatus.message)}</p>`
    : '';
  const loading = state.shelfLoading ? `<p class="shelf-loading" role="status">Updating your Shelves…</p>` : '';
  if (!account) {
    return `<section class="my-space-page visitor-my-space">
      <div class="page-heading-row shelf-page-heading"><div><p class="eyebrow">Collected by you</p><h1 class="page-title">My Space</h1><p class="page-subtitle">A personal place for the posts you want to revisit, private or public.</p></div><button class="primary-button" type="button" data-action="open-shelf-signup-prompt" data-shelf-prompt-focus="create" data-testid="button-create-shelf-visitor">${icon('plus', 15)} Create a Shelf</button></div>
      <p class="shelf-preview-note">These cards preview the layout only. Join to create Shelves that belong to your account.</p>
      <div class="shelf-preview-grid">${[1, 2, 3, 4].map(renderShelfPreviewCard).join('')}</div>
    </section>`;
  }
  return `<section><div class="page-heading-row shelf-page-heading"><div><p class="eyebrow">Collected by you</p><h1 class="page-title">My Space</h1><p class="page-subtitle">Your personal Shelves — a place for the posts you want to revisit, private or public.</p></div><button class="primary-button" type="button" data-action="create-shelf" ${state.shelfLoading ? 'disabled' : ''}>${icon('plus', 15)} Create a Shelf</button></div>
    ${status}${loading}
    ${shelves.length ? `<div class="my-space-shelf-grid">${shelves.map(renderMySpaceShelfCard).join('')}</div>` : `${renderEmpty('Your shelves are empty.', 'Create a Shelf to keep fan posts you want to revisit.')}<div class="empty-action"><button class="quiet-button" type="button" data-action="create-shelf" ${state.shelfLoading ? 'disabled' : ''}>Create your first Shelf ${icon('arrow', 14)}</button></div>`}
  </section>`;
}

function renderShelfDetail(shelfId) {
  const account = activeAccount();
  const shelf = state.shelves.find((entry) => entry.id === shelfId);
  const owner = Boolean(shelf && account?.id === shelf.ownerId);
  if (!shelf || (!owner && shelf.visibility !== 'public')) {
    return `<section><p class="eyebrow">Personal Shelf</p><h1 class="page-title">Shelf not available.</h1><p class="page-subtitle">This Shelf may be private or no longer available.</p>${renderEmpty('Shelf not found.')}<div class="empty-action"><a class="quiet-button" href="${hrefFor('/shelves')}" data-route="/shelves">Back to Shelves ${icon('arrow', 14)}</a></div></section>`;
  }

  const shelfOwner = state.accounts.find((entry) => entry.id === shelf.ownerId);
  const posts = shelf.postIds.map((postId) => state.posts.find((post) => post.id === postId)).filter((post) => post && isVisibleFanPost(post));
  const status = owner && state.shelfStatus?.ownerId === account.id && state.shelfStatus?.shelfId === shelf.id
    ? `<p class="success-banner ${state.shelfStatus.kind === 'error' ? 'shelf-error-banner' : ''}" role="${state.shelfStatus.kind === 'error' ? 'alert' : 'status'}">${state.shelfStatus.kind === 'error' ? icon('close', 15) : icon('check', 15)}${escapeHTML(state.shelfStatus.message)}</p>`
    : '';
  const ownerRoute = `/profile/${encodeURIComponent(shelf.ownerId)}`;
  const confirmDelete = owner && state.shelfDeleteConfirmId === shelf.id;
  const actions = owner
    ? `<div class="shelf-manage-actions"><button class="quiet-button" type="button" data-action="edit-shelf" data-shelf-id="${escapeHTML(shelf.id)}" ${state.shelfLoading ? 'disabled' : ''}>${icon('edit', 14)} Edit Shelf</button><button class="text-button text-danger" type="button" data-action="delete-shelf" data-shelf-id="${escapeHTML(shelf.id)}" ${state.shelfLoading ? 'disabled' : ''}>${icon('trash', 14)} Delete Shelf</button></div>`
    : '';
  const deletePrompt = confirmDelete
    ? `<div class="shelf-delete-confirm" role="alert"><span>Delete this Shelf? Saved posts will remain on their original boards.</span><button class="text-button text-danger" type="button" data-action="confirm-delete-shelf" data-shelf-id="${escapeHTML(shelf.id)}" ${state.shelfLoading ? 'disabled' : ''}>${state.shelfLoading ? 'Deleting…' : 'Delete Shelf'}</button><button class="text-button" type="button" data-action="cancel-delete-shelf" ${state.shelfLoading ? 'disabled' : ''}>Cancel</button></div>`
    : '';
  return `<section><p class="eyebrow">Personal Shelf</p><a class="shelf-back-link" href="${hrefFor('/shelves')}" data-route="/shelves">${icon('back', 14)} All Shelves</a>
    <div class="shelf-detail-heading"><div><span class="shelf-visibility shelf-visibility-${shelf.visibility}">${shelf.visibility === 'public' ? 'Public' : 'Private'}</span><h1 class="page-title">${escapeHTML(shelf.title)}</h1>${shelf.description ? `<p class="page-subtitle shelf-detail-description">${escapeHTML(shelf.description)}</p>` : ''}<p class="shelf-owner-line">By <a href="${hrefFor(ownerRoute)}" data-route="${ownerRoute}">${escapeHTML(shelfOwner?.name || 'Stillroom member')}</a></p></div>${actions}</div>
    ${status}${deletePrompt}
    ${posts.length ? `<div class="shelf-post-list">${posts.map((post) => {
      const board = state.boards.find((entry) => entry.id === post.boardId);
      const route = board ? `/board/${encodeURIComponent(board.id)}` : '/explore';
      return `<article class="shelf-post-item"><div class="shelf-post-toolbar"><a class="text-link" href="${hrefFor(route)}" data-route="${route}">Open original Artist Board ${icon('arrow', 13)}</a>${owner ? `<button class="text-button text-danger" type="button" data-action="remove-post-from-shelf" data-shelf-id="${escapeHTML(shelf.id)}" data-post-id="${escapeHTML(post.id)}">${icon('trash', 13)} Remove from Shelf</button>` : ''}</div>${renderPostCard(post)}</article>`;
    }).join('')}</div>` : renderEmpty('This Shelf is empty.', owner ? 'Add fan posts from any Artist Board to collect them here.' : 'There are no saved posts in this Shelf yet.')}
  </section>`;
}

function shelfFieldError(field) {
  return state.shelfErrors[field] ? `<span class="field-error" id="shelf-error-${field}" role="alert">${escapeHTML(state.shelfErrors[field])}</span>` : '';
}

function renderShelfForm(mode, shelfId = null) {
  const account = activeAccount();
  if (!account) {
    return renderAccountGate('Personal Shelves', mode === 'edit' ? 'Edit a Shelf' : 'Create a Shelf', 'Join Stillroom to create, edit, and organize your personal Shelves.');
  }
  const existing = shelfId ? state.shelves.find((shelf) => shelf.id === shelfId && shelf.ownerId === account?.id) : null;
  if (!account || (mode === 'edit' && !existing)) {
    return `<section><p class="eyebrow">Personal Shelf</p><h1 class="page-title">Shelf unavailable.</h1>${renderEmpty('You can only edit your own Shelves.')}<div class="empty-action"><a class="quiet-button" href="${hrefFor('/shelves')}" data-route="/shelves">Back to Shelves</a></div></section>`;
  }
  if (!state.shelfDraft || state.shelfDraft.shelfId !== (existing?.id || null)) {
    state.shelfDraft = existing
      ? { shelfId: existing.id, title: existing.title, description: existing.description, visibility: existing.visibility }
      : { shelfId: null, title: '', description: '', visibility: 'private' };
  }
  const draft = state.shelfDraft;
  const disabled = state.shelfLoading ? 'disabled' : '';
  const formError = state.shelfErrors.form ? `<p class="inline-error" role="alert">${escapeHTML(state.shelfErrors.form)}</p>` : '';
  const cancelRoute = existing ? `/shelves/${encodeURIComponent(existing.id)}` : (state.shelfReturnRoute || '/shelves');
  return `<section><p class="eyebrow">${existing ? 'Make a change' : 'A place to return to'}</p><h1 class="page-title">${existing ? 'Edit Shelf' : 'Create a Shelf'}</h1><p class="page-subtitle">Choose what to keep close. You can change visibility at any time.</p>
    <div class="shelf-form-card">${formError}
      <form data-form="shelf" data-mode="${mode}" data-shelf-id="${escapeHTML(existing?.id || '')}" novalidate ${state.shelfLoading ? 'aria-busy="true"' : ''}>
        <label class="field-label">Shelf title<input class="field-input" name="title" maxlength="80" value="${escapeHTML(draft.title)}" placeholder="A title for this collection" aria-invalid="${Boolean(state.shelfErrors.title)}" ${state.shelfErrors.title ? 'aria-describedby="shelf-error-title"' : ''} ${disabled} required>${shelfFieldError('title')}</label>
        <label class="field-label">Description <span class="optional-label">(optional)</span><textarea class="field-input field-textarea" name="description" rows="4" maxlength="500" placeholder="What brings these posts together?" aria-invalid="${Boolean(state.shelfErrors.description)}" ${state.shelfErrors.description ? 'aria-describedby="shelf-error-description"' : ''} ${disabled}>${escapeHTML(draft.description)}</textarea>${shelfFieldError('description')}</label>
        <label class="field-label">Visibility<select class="field-input shelf-visibility-select" name="visibility" ${disabled}><option value="private" ${draft.visibility === 'private' ? 'selected' : ''}>Private — only you can view this Shelf</option><option value="public" ${draft.visibility === 'public' ? 'selected' : ''}>Public — visible from your profile</option></select></label>
        <div class="shelf-form-footer"><button class="primary-button" type="submit" ${disabled}>${state.shelfLoading ? `<span class="registration-loading"><span class="loading-dot"></span>Saving…</span>` : `${existing ? 'Save changes' : 'Create Shelf'} ${icon('arrow', 14)}`}</button><button class="quiet-button" type="button" data-action="cancel-shelf-form" data-cancel-route="${cancelRoute}" ${disabled}>Cancel</button></div>
      </form>
    </div>
  </section>`;
}

function beginShelfForm(mode, shelfId = null) {
  const account = activeAccount();
  const shelf = shelfId ? state.shelves.find((entry) => entry.id === shelfId && entry.ownerId === account?.id) : null;
  if (!account || (mode === 'edit' && !shelf)) return;
  state.shelfDraft = shelf
    ? { shelfId: shelf.id, title: shelf.title, description: shelf.description, visibility: shelf.visibility }
    : { shelfId: null, title: '', description: '', visibility: 'private' };
  state.shelfErrors = {};
  state.shelfStatus = null;
  state.shelfDeleteConfirmId = null;
  if (state.shelfPickerPostId) {
    state.shelfPickerPostId = null;
    state.shelfPickerSelection = [];
    state.shelfPickerError = '';
  }
  navigate(shelf ? `/shelves/${encodeURIComponent(shelf.id)}/edit` : '/shelves/new');
}

async function submitShelfForm(form) {
  const generation = authGeneration;
  const account = activeAccount();
  if (!account || state.shelfLoading) return;
  const mode = form.dataset.mode === 'edit' ? 'edit' : 'create';
  const shelfId = form.dataset.shelfId || null;
  const formData = new FormData(form);
  const values = {
    title: String(formData.get('title') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    visibility: String(formData.get('visibility') || 'private'),
  };
  const errors = {};
  if (!values.title) errors.title = 'Add a title for your Shelf.';
  else if (values.title.length > 80) errors.title = 'Shelf titles must be 80 characters or fewer.';
  if (values.description.length > 500) errors.description = 'Descriptions must be 500 characters or fewer.';
  if (!['private', 'public'].includes(values.visibility)) errors.form = 'Choose whether this Shelf is private or public.';
  const existing = mode === 'edit'
    ? state.shelves.find((shelf) => shelf.id === shelfId && shelf.ownerId === account.id)
    : null;
  if (mode === 'edit' && !existing) errors.form = 'This Shelf is no longer available to edit.';
  state.shelfDraft = { shelfId, ...values };
  state.shelfErrors = errors;
  if (Object.keys(errors).length) {
    render();
    app.querySelector('[name="title"]')?.focus();
    return;
  }

  state.shelfLoading = true;
  state.pendingShelf = { action: mode, shelfId, ownerId: account.id, values };
  render();
  const previousShelfIds = new Set(state.shelves.map((shelf) => shelf.id));
  try {
    const data = await persistAction('shelf.save', {
      shelfId: mode === 'edit' ? shelfId : null,
      ...values,
    });
    if (generation !== authGeneration) return;
    const shelf = mode === 'edit'
      ? data.shelves.find((entry) => entry.id === shelfId)
      : data.shelves.find((entry) => entry.ownerId === account.id && !previousShelfIds.has(entry.id));
    if (!shelf) throw new Error('Your Shelf could not be found after saving.');
    const returnPostId = mode === 'create' ? state.shelfReturnPostId : null;
    state.shelfStatus = {
      ownerId: account.id,
      shelfId: shelf.id,
      message: mode === 'create' ? 'Shelf created.' : 'Shelf updated.',
    };
    state.shelfDraft = null;
    state.shelfErrors = {};
    state.shelfLoading = false;
    state.shelfTimer = null;
    state.pendingShelf = null;
    state.shelfReturnPostId = null;
    state.shelfReturnRoute = null;
    if (returnPostId) {
      navigate(`/post/${encodeURIComponent(returnPostId)}`, { refresh: false });
      await refreshPublicContent();
      if (generation === authGeneration) openShelfPicker(returnPostId, shelf.id);
    } else navigate(`/shelves/${encodeURIComponent(shelf.id)}`);
  } catch (error) {
    if (generation !== authGeneration) return;
    state.shelfErrors = { form: error.message || 'This Shelf could not be saved. Please try again.' };
    state.shelfLoading = false;
    state.shelfTimer = null;
    state.pendingShelf = null;
    render();
  }
}

function openShelfPicker(postId, preselectedShelfId = null) {
  const account = activeAccount();
  const post = state.posts.find((entry) => entry.id === postId && isVisibleFanPost(entry));
  if (!account || !post || state.shelfLoading) return;
  state.shelfPickerPostId = post.id;
  state.shelfPickerScope = [];
  state.shelfPickerSelection = [];
  state.shelfPickerPage = 0;
  state.shelfPickerHasMore = false;
  state.shelfPickerBusy = false;
  state.shelfPickerError = '';
  render();
  void loadPickerShelves(0, preselectedShelfId);
}

let pickerReadSequence = 0;
async function loadPickerShelves(page, preselectedShelfId = null) {
  const account = activeAccount();
  const postId = state.shelfPickerPostId;
  if (!account || !postId || state.shelfPickerBusy) return;
  const generation = authGeneration;
  const request = ++pickerReadSequence;
  state.shelfPickerAttemptPage = page;
  state.shelfPickerBusy = true;
  state.shelfPickerError = '';
  render();
  try {
    const data = await getShelves({ postId, page });
    if (generation !== authGeneration || request !== pickerReadSequence || state.shelfPickerPostId !== postId) return;
    state.shelves = [...new Map([...state.shelves, ...data.shelves].map((shelf) => [shelf.id, shelf])).values()];
    const knownShelves = new Set(state.shelfPickerScope);
    state.shelfPickerScope = [...new Set([...state.shelfPickerScope, ...data.shelves.map((shelf) => shelf.id)])];
    state.shelfPickerSelection = [...new Set([...state.shelfPickerSelection,
      ...data.shelves.filter((shelf) => !knownShelves.has(shelf.id) && (shelf.postIds.includes(postId) || shelf.id === preselectedShelfId)).map((shelf) => shelf.id)])];
    state.shelfPickerPage = page;
    state.shelfPickerHasMore = data.pagination.hasMore;
  } catch (error) {
    if (generation === authGeneration && request === pickerReadSequence && state.shelfPickerPostId === postId) state.shelfPickerError = error.message || 'Your Shelves could not be loaded.';
  } finally {
    if (generation === authGeneration && request === pickerReadSequence && state.shelfPickerPostId === postId) {
      state.shelfPickerBusy = false;
      render();
    }
  }
}

async function submitShelfPicker(form) {
  const generation = authGeneration;
  const account = activeAccount();
  const postId = form.dataset.postId;
  const post = state.posts.find((entry) => entry.id === postId && isVisibleFanPost(entry));
  if (!account || !post || state.shelfLoading || state.shelfPickerBusy) {
    state.shelfPickerError = 'This post is no longer available to save.';
    render();
    return;
  }
  const ownedShelves = state.shelves.filter((shelf) => shelf.ownerId === account.id);
  const selectedIds = [...new Set(new FormData(form).getAll('shelfIds').map(String))];
  if (selectedIds.some((id) => !ownedShelves.some((shelf) => shelf.id === id))) {
    state.shelfPickerError = 'Choose only Shelves in your collection.';
    render();
    return;
  }
  const alreadySaved = ownedShelves.some((shelf) => shelf.postIds.includes(postId));
  if (!selectedIds.length && !alreadySaved) {
    state.shelfPickerError = 'Choose at least one Shelf to save this post, or cancel.';
    render();
    return;
  }
  state.shelfPickerSelection = selectedIds;
  state.shelfPickerError = '';
  state.shelfLoading = true;
  state.pendingShelf = { action: 'save-post', postId, ownerId: account.id, selectedIds };
  render();
  try {
    await persistAction('shelf.setPosts', { postId, shelfIds: selectedIds, scopeShelfIds: state.shelfPickerScope });
    if (generation !== authGeneration) return;
    const count = selectedIds.length;
    state.shelfStatus = {
      ownerId: account.id,
      postId,
      message: count ? `Saved to ${count} ${count === 1 ? 'Shelf' : 'Shelves'}.` : 'Removed from the selected Shelves.',
    };
    state.shelfPickerPostId = null;
    state.shelfPickerSelection = [];
    state.shelfPickerError = '';
    state.shelfLoading = false;
    state.shelfTimer = null;
    state.pendingShelf = null;
    render();
  } catch (error) {
    if (generation !== authGeneration) return;
    state.shelfPickerError = error.message || 'This post could not be saved. Please try again.';
    state.shelfLoading = false;
    state.shelfTimer = null;
    state.pendingShelf = null;
    render();
  }
}

async function removePostFromShelf(shelfId, postId) {
  const generation = authGeneration;
  const account = activeAccount();
  const shelf = state.shelves.find((entry) => entry.id === shelfId && entry.ownerId === account?.id);
  if (!account || !shelf || !shelf.postIds.includes(postId)) return;
  state.shelfLoading = true;
  render();
  try {
    await persistAction('shelf.removePost', { shelfId, postId });
    if (generation !== authGeneration) return;
    state.shelfStatus = { ownerId: account.id, shelfId, message: 'Post removed from this Shelf.' };
  } catch (error) {
    if (generation !== authGeneration) return;
    state.shelfStatus = { ownerId: account.id, shelfId, kind: 'error', message: error.message || 'The post could not be removed.' };
  } finally {
    if (generation !== authGeneration) return;
    state.shelfLoading = false;
    render();
  }
}

async function confirmDeleteShelf(shelfId) {
  const generation = authGeneration;
  const account = activeAccount();
  const shelf = state.shelves.find((entry) => entry.id === shelfId && entry.ownerId === account?.id);
  if (!account || !shelf || state.shelfLoading) return;
  state.shelfLoading = true;
  state.pendingShelf = { action: 'delete', shelfId, ownerId: account.id };
  render();
  try {
    await persistAction('shelf.delete', { shelfId });
    if (generation !== authGeneration) return;
    state.shelfDeleteConfirmId = null;
    state.shelfStatus = { ownerId: account.id, message: 'Shelf deleted. Its original posts remain on their Artist Boards.' };
    navigate('/shelves');
  } catch (error) {
    if (generation !== authGeneration) return;
    state.shelfStatus = { ownerId: account.id, shelfId, kind: 'error', message: error.message || 'This Shelf could not be deleted. Please try again.' };
  } finally {
    if (generation !== authGeneration) return;
    state.shelfLoading = false;
    state.shelfTimer = null;
    state.pendingShelf = null;
    render();
  }
}

function renderProfileAvatar(image, name, username, large = false) {
  const className = `profile-avatar${large ? ' profile-avatar-large' : ''}`;
  if (image) return `<img class="${className} profile-avatar-image" src="${escapeHTML(image)}" alt="${escapeHTML(name)} profile image">`;
  return `<span class="${className}" aria-hidden="true">${escapeHTML((name.trim()[0] || username[0] || 'S').toUpperCase())}</span>`;
}

function renderProfileHandle(profile) {
  const route = `/profile/${encodeURIComponent(profile.id)}`;
  return `<a class="profile-meta profile-handle-link" href="${hrefFor(route)}" data-route="${route}">@${escapeHTML(profile.username)}</a>`;
}

function renderProfileStatus(profileId) {
  return state.profileStatus?.userId === profileId
    ? `<p class="success-banner profile-success" role="status">${icon('check', 15)}${escapeHTML(state.profileStatus.message)}</p>`
    : '';
}

function renderFanProfileForm(profile) {
  const draft = state.profileDraft || {
    name: profile.name,
    biography: profile.biography || '',
    interests: profile.interests || '',
    profileImage: profile.profileImage || '',
  };
  const disabled = state.profileLoading || state.profileImageLoading || state.usernameLoading ? 'disabled' : '';
  const nameError = state.profileFieldErrors.name || '';
  const biographyError = state.profileFieldErrors.biography || '';
  const interestsError = state.profileFieldErrors.interests || '';
  const preview = draft.profileImage
    ? `<div class="profile-image-preview"><img src="${escapeHTML(draft.profileImage)}" alt="Profile image preview"><div><p class="preview-title">Profile image selected</p><button class="text-button text-danger" type="button" data-action="remove-profile-image" ${disabled}>Remove image</button></div></div>`
    : '';
  return `<form class="profile-form" data-form="profile" novalidate ${state.profileLoading || state.profileImageLoading || state.usernameLoading ? 'aria-busy="true"' : ''}>
    ${state.profileError ? `<p class="inline-error" role="alert">${escapeHTML(state.profileError)}</p>` : ''}
    <label class="field-label">Display name<input class="field-input" name="profileName" value="${escapeHTML(draft.name)}" maxlength="80" placeholder="Your name" aria-invalid="${Boolean(nameError)}" ${nameError ? 'aria-describedby="profile-name-error"' : ''} ${disabled} required></label>
    ${nameError ? `<p class="inline-error" id="profile-name-error" role="alert">${escapeHTML(nameError)}</p>` : ''}
    <label class="field-label">Biography <span class="optional-label">(optional)</span><textarea class="field-input field-textarea" name="profileBiography" rows="4" maxlength="500" placeholder="A few words about you" aria-invalid="${Boolean(biographyError)}" ${biographyError ? 'aria-describedby="profile-biography-error"' : ''} ${disabled}>${escapeHTML(draft.biography)}</textarea></label>
    ${biographyError ? `<p class="inline-error" id="profile-biography-error" role="alert">${escapeHTML(biographyError)}</p>` : ''}
    <label class="field-label">Artistic interests <span class="optional-label">(optional)</span><input class="field-input" name="profileInterests" value="${escapeHTML(draft.interests || '')}" maxlength="200" placeholder="Music, film, photography…" aria-invalid="${Boolean(interestsError)}" ${interestsError ? 'aria-describedby="profile-interests-error"' : ''} ${disabled}></label>
    ${interestsError ? `<p class="inline-error" id="profile-interests-error" role="alert">${escapeHTML(interestsError)}</p>` : ''}
    <label class="field-label">Profile image <span class="optional-label">(optional)</span><input class="file-input" type="file" accept="image/png,image/jpeg,image/webp" data-profile-image ${disabled}><span class="field-hint">PNG, JPG, or WebP. Maximum 4 MB.</span></label>
    ${state.profileImageLoading ? `<p class="field-hint" role="status">Preparing profile image…</p>` : ''}
    ${state.profileImageError ? `<p class="inline-error" role="alert">${escapeHTML(state.profileImageError)}</p>` : ''}
    ${preview}
    <div class="profile-form-actions"><button class="primary-button" type="submit" ${disabled}>${state.profileLoading ? `<span class="registration-loading"><span class="loading-dot"></span>Saving…</span>` : 'Save profile'}</button><button class="quiet-button" type="button" data-action="cancel-profile-edit" ${disabled}>Cancel</button></div>
  </form>`;
}

function renderUsernameChange(profile) {
  const success = state.usernameStatus?.userId === profile.id
    ? `<p class="success-banner username-success" role="status">${icon('check', 14)}${escapeHTML(state.usernameStatus.message)}</p>`
    : '';
  if (!state.usernameEditorOpen) {
    return `<section class="username-change-section">
      <div><p class="eyebrow">Username</p><p class="username-current">@${escapeHTML(profile.username)}</p></div>
      <button class="quiet-button" type="button" data-action="open-username-editor">Change Username</button>
      ${success}
    </section>`;
  }
  const error = state.usernameError;
  const disabled = state.usernameLoading ? 'disabled' : '';
  return `<section class="username-change-section username-change-open">
    <h2 class="section-heading">Change Username</h2>
    ${success}
    <form class="username-change-form" data-form="username" data-user-id="${escapeHTML(profile.id)}" novalidate ${state.usernameLoading ? 'aria-busy="true"' : ''}>
      <label class="field-label">New username<input class="field-input" name="newUsername" value="${escapeHTML(state.usernameDraft)}" autocomplete="username" placeholder="Choose a username" aria-invalid="${Boolean(error)}" ${error ? 'aria-describedby="username-change-error"' : ''} ${disabled} required></label>
      ${error ? `<p class="inline-error" id="username-change-error" role="alert">${escapeHTML(error)}</p>` : ''}
      <p class="field-hint">Usernames must be unique. Your existing posts and comments will display your new username.</p>
      <div class="profile-form-actions"><button class="primary-button" type="submit" ${disabled}>${state.usernameLoading ? `<span class="registration-loading"><span class="loading-dot"></span>Saving…</span>` : 'Save Changes'}</button><button class="quiet-button" type="button" data-action="cancel-username-editor" ${disabled}>Cancel</button></div>
    </form>
  </section>`;
}

function profileTabButtons(profileId, tab, label) {
  const tabs = [['posts', 'image', 'Posts'], ['reposts', 'repost', 'Reposts'], ['shelves', 'bookmark', 'Shelves']];
  return `<div class="sr-profile-tabs" role="tablist" aria-label="${escapeHTML(label)}">${tabs.map(([key, glyph, text]) => `<button class="sr-profile-tab" id="profile-tab-${key}" type="button" data-action="profile-activity-tab" data-profile-id="${escapeHTML(profileId)}" data-tab="${key}" role="tab" aria-label="${text}" aria-controls="profile-tab-panel" aria-selected="${tab === key}" data-testid="tab-profile-${key}">${icon(glyph, 15)}<span>${text}</span></button>`).join('')}</div>`;
}

function renderProfileGridTile(post, repost = null) {
  const board = state.boards.find((entry) => entry.id === post.boardId);
  const author = state.accounts.find((entry) => entry.id === post.authorId);
  const username = post.authorUsername || author?.username || '';
  const route = `/post/${encodeURIComponent(post.id)}`;
  const media = post.media;
  const visual = media?.type === 'image'
    ? `<img class="sr-tile-media" src="${escapeHTML(media.url)}" alt="Image shared by @${escapeHTML(username)}" loading="lazy">`
    : media?.type === 'video'
      ? `<video class="sr-tile-media" src="${escapeHTML(media.url)}" preload="metadata" muted playsinline aria-hidden="true"></video><span class="sr-tile-badge">Video</span>`
      : `<span class="sr-tile-text">${escapeHTML((post.content || '').trim().slice(0, 220))}</span>`;
  const account = activeAccount();
  const ownRepost = repost && account?.role === 'Fan' && repost.userId === account.id;
  const confirming = ownRepost && state.repostConfirm?.postId === post.id && state.repostConfirm?.userId === account.id;
  const pending = ownRepost && state.repostPending?.postId === post.id;
  return `<article class="sr-tile${media ? ' sr-tile-visual' : ' sr-tile-plain'}" data-testid="card-profile-post-${escapeHTML(post.id)}">
    <a class="sr-tile-link" href="${hrefFor(route)}" data-route="${route}" aria-label="Open post by @${escapeHTML(username)}${board ? ` on ${escapeHTML(board.artistName)}’s Board` : ''}">
      ${visual}
      <span class="sr-tile-caption"><span class="sr-tile-author">@${escapeHTML(username)}</span>${board ? `<span class="sr-tile-board">on ${escapeHTML(board.artistName)}</span>` : ''}</span>
    </a>
    ${ownRepost ? `<div class="sr-tile-tools">${confirming
      ? `<span>Undo repost?</span><button class="text-button text-danger" type="button" data-action="confirm-repost" data-post-id="${escapeHTML(post.id)}">Confirm</button><button class="text-button" type="button" data-action="cancel-repost">Cancel</button>`
      : pending ? '<span role="status">Undoing…</span>'
      : `<button class="text-button" type="button" data-action="toggle-repost" data-post-id="${escapeHTML(post.id)}" ${state.repostPending ? 'disabled' : ''} data-testid="button-undo-repost-${escapeHTML(post.id)}">${icon('repost', 13)} Undo repost</button>`}</div>` : ''}
  </article>`;
}

function renderProfileQuietEmpty(message, action = '') {
  return `<div class="sr-profile-empty"><p>${escapeHTML(message)}</p>${action}</div>`;
}

function renderProfileTabs(profile, isOwner) {
  const tab = state.profileActivityTabs[profile.id] || 'posts';
  const isArtist = profile.role === 'Artist';
  const board = isArtist ? boardForOwner(profile.id) : null;
  let body;
  if (tab === 'shelves') {
    const shelves = state.shelves.filter((shelf) => shelf.ownerId === profile.id && (isOwner || shelf.visibility === 'public'));
    body = shelves.length
      ? `<div class="sr-shelf-grid">${shelves.map(renderMySpaceShelfCard).join('')}</div>`
      : renderProfileQuietEmpty(isOwner ? 'Your Shelves will appear here.' : 'No public Shelves yet.');
    if (isOwner) body = `<div class="sr-tab-tools"><button class="text-link" type="button" data-action="create-shelf">${icon('plus', 13)} New Shelf</button><a class="text-link" href="${hrefFor('/shelves')}" data-route="/shelves">Manage in My Space ${icon('arrow', 13)}</a></div>${body}`;
  } else if (tab === 'posts' && isArtist) {
    const posts = board ? chronologicalPosts(state.posts.filter((post) => post.boardId === board.id && isVisibleFanPost(post))).reverse() : [];
    body = posts.length
      ? `<p class="sr-tab-note">Fan contributions on this Board.</p><div class="sr-grid">${posts.map((post) => renderProfileGridTile(post)).join('')}</div>`
      : renderProfileQuietEmpty(board ? 'No posts yet.' : 'No Board yet.', '');
  } else {
    const items = accountActivityItems(profile.id).filter((item) => item.type === (tab === 'posts' ? 'post' : 'repost')).reverse();
    body = items.length
      ? `<div class="sr-grid">${items.map((item) => renderProfileGridTile(item.post, item.repost || null)).join('')}</div>`
      : renderProfileQuietEmpty(tab === 'posts' ? 'No posts yet.' : 'No reposts yet.',
        isOwner && tab === 'posts' && !isArtist ? `<a class="text-link" href="${hrefFor('/explore')}" data-route="/explore">Find a Board to post on ${icon('arrow', 13)}</a>` : '');
  }
  const feedback = isOwner && state.repostStatus?.userId === profile.id
    ? `<p class="${state.repostStatus.kind === 'error' ? 'inline-error' : 'field-hint'}" role="${state.repostStatus.kind === 'error' ? 'alert' : 'status'}">${escapeHTML(state.repostStatus.message)}</p>` : '';
  return `<section class="sr-profile-content">${profileTabButtons(profile.id, tab, `${profile.username} profile content`)}${feedback}<div class="sr-tab-panel" id="profile-tab-panel" role="tabpanel" aria-labelledby="profile-tab-${escapeHTML(tab)}">${body}</div></section>`;
}

function renderProfileFollowing(profile, isOwner) {
  // Followed Artists are private: only the owner ever sees this row.
  if (!isOwner || profile.role !== 'Fan') return '';
  const followed = new Set(followedArtistIds(profile.id));
  const boards = state.boards.filter((board) => followed.has(board.ownerId));
  if (!boards.length) return `<div class="sr-following sr-following-empty"><a class="text-link" href="${hrefFor('/explore')}" data-route="/explore">Discover Artists ${icon('arrow', 13)}</a></div>`;
  const shown = boards.slice(0, 8);
  return `<div class="sr-following"><span class="sr-following-label">My Artists</span><ul class="sr-following-row">${shown.map((board) => {
    const route = `/board/${encodeURIComponent(board.id)}`;
    const face = board.profileImage ? `<img src="${escapeHTML(board.profileImage)}" alt="">` : `<span aria-hidden="true">${escapeHTML((board.artistName.trim()[0] || 'A').toUpperCase())}</span>`;
    return `<li><a class="sr-following-face" href="${hrefFor(route)}" data-route="${route}" title="${escapeHTML(board.artistName)}" aria-label="${escapeHTML(board.artistName)} Board">${face}</a></li>`;
  }).join('')}</ul><a class="text-link" href="${hrefFor('/artists')}" data-route="/artists">See All</a></div>`;
}

function renderProfileHeader(profile, isOwner) {
  const isArtist = profile.role === 'Artist';
  const board = isArtist ? boardForOwner(profile.id) : null;
  const name = board?.artistName || profile.name;
  const image = isArtist ? board?.profileImage || '' : profile.profileImage || '';
  const bio = isArtist ? board?.biography : profile.biography;
  const boardRoute = board ? `/board/${encodeURIComponent(board.id)}` : '';
  const busy = state.usernameLoading || state.authActionLoading ? 'disabled' : '';
  const editing = isOwner && state.editingProfile && !isArtist;
  return `<header class="sr-profile-header">
    ${renderProfileAvatar(image, name, profile.username, true)}
    <div class="sr-profile-id">
      <div class="sr-profile-topline">
        <h1 class="sr-profile-username">@${escapeHTML(profile.username)}</h1>
        ${isOwner ? `<div class="sr-profile-owner-actions">
          ${!editing && (!isArtist || board) ? `<button class="quiet-button sr-edit" type="button" data-action="edit-profile" data-testid="button-edit-profile">${icon('edit', 13)} Edit Profile</button>` : ''}
          <a class="icon-button sr-settings" href="${hrefFor('/settings')}" data-route="/settings" data-testid="link-settings" aria-label="Account and security settings" title="Account &amp; Security">${icon('settings', 18)}</a>
          <button class="icon-button sr-switch" type="button" data-action="switch-account" ${busy} aria-label="Sign in to a different account" title="${state.authActionLoading ? 'Signing out…' : 'Switch account (signs you out first)'}">${icon('logout', 17)}</button>
        </div>` : ''}
      </div>
      <p class="sr-profile-name">${escapeHTML(name)} <span class="sr-profile-role">${isArtist ? (board ? escapeHTML(board.discipline) + ' · Artist' : 'Artist') : 'Fan'}</span></p>
      ${bio ? `<p class="sr-profile-bio">${escapeHTML(bio)}</p>` : isOwner && !isArtist ? '<p class="sr-profile-bio sr-muted">Add a short biography with Edit Profile.</p>' : ''}
      ${!isArtist && profile.interests ? `<p class="sr-profile-interests">${escapeHTML(profile.interests)}</p>` : ''}
      ${isArtist ? (board ? `<a class="sr-board-link" href="${hrefFor(boardRoute)}" data-route="${boardRoute}" data-testid="link-artist-board">${icon('artists', 14)} Official Board ${icon('arrow', 12)}</a>`
        : isOwner ? `<button class="primary-button sr-create-board" type="button" data-action="create-board" ${state.usernameLoading ? 'disabled' : ''}>Create your Artist Board ${icon('arrow', 14)}</button>`
        : '<p class="sr-profile-bio sr-muted">This Artist hasn’t created a Board yet.</p>') : ''}
      ${renderProfileFollowing(profile, isOwner)}
    </div>
  </header>
  ${isOwner && state.authActionLoading ? '<p class="field-hint" role="status">Signing out…</p>' : ''}
  ${renderProfileStatus(profile.id)}
  ${editing ? `<div class="sr-profile-editor">${renderFanProfileForm(profile)}${renderUsernameChange(profile)}</div>` : ''}
  ${isOwner && isArtist && !board ? `<div class="sr-profile-editor">${renderUsernameChange(profile)}</div>` : ''}`;
}

function renderProfilePage(profile, isOwner) {
  return `<section class="sr-profile" data-testid="profile-${escapeHTML(profile.id)}">${renderProfileHeader(profile, isOwner)}${renderProfileTabs(profile, isOwner)}</section>`;
}

function renderVisitorProfile() {
  return `<section class="sr-profile sr-profile-guest">
    <div class="sr-guest">
      <span class="profile-avatar profile-avatar-large" aria-hidden="true">${icon('profile', 28)}</span>
      <div><h1 class="sr-profile-username">Your profile</h1><p class="sr-profile-bio">Join Stillroom to keep your posts, reposts and Shelves in one place.</p>
      <div class="sr-guest-actions"><button class="primary-button" type="button" data-action="join" data-testid="button-profile-join">Join Stillroom ${icon('arrow', 14)}</button><a class="quiet-button" href="${hrefFor('/login')}" data-route="/login" data-testid="link-profile-sign-in">Sign In</a></div></div>
    </div>
  </section>`;
}

function renderProfile() {
  const account = activeAccount();
  if (!account) return renderVisitorProfile();
  return renderProfilePage(account, true);
}

function renderPublicProfile(accountId) {
  const profile = state.accounts.find((entry) => entry.id === accountId);
  if (!profile) {
    return `<section class="sr-profile"><h1 class="sr-profile-username">Profile not found.</h1>${renderProfileQuietEmpty('This profile isn’t available in this session.')}</section>`;
  }
  return renderProfilePage(profile, activeAccount()?.id === profile.id);
}

function beginProfileEdit() {
  const account = activeAccount();
  if (!account) return;
  if (account.role === 'Artist') {
    beginBoardForm(boardForOwner(account.id) ? 'edit' : 'create');
    return;
  }
  state.usernameEditorOpen = false;
  state.usernameDraft = '';
  state.usernameError = '';
  state.usernameStatus = null;
  state.profileDraft = {
    name: account.name || '',
    biography: account.biography || '',
    interests: account.interests || '',
    profileImage: account.profileImage || '',
    profileImageAssetId: account.profileImageAssetId || null,
  };
  state.profileError = '';
  state.profileFieldErrors = {};
  state.profileImageError = '';
  state.profileImageLoading = false;
  state.profileImageToken += 1;
  state.profileStatus = null;
  state.editingProfile = true;
  render();
  app.querySelector('[name="profileName"]')?.focus();
}

function cancelProfileEdit() {
  if (state.profileLoading || state.usernameLoading) return;
  state.profileDraft = null;
  state.profileError = '';
  state.profileFieldErrors = {};
  state.profileImageError = '';
  state.profileImageLoading = false;
  state.profileImageToken += 1;
  state.editingProfile = false;
  state.usernameEditorOpen = false;
  state.usernameDraft = '';
  state.usernameError = '';
  render();
}

function cancelProfileOperation() {
  if (state.profileTimer) window.clearTimeout(state.profileTimer);
  state.profileTimer = null;
  state.profilePending = null;
  state.profileLoading = false;
}

function resetUsernameEditor() {
  if (state.usernameTimer) window.clearTimeout(state.usernameTimer);
  state.usernameTimer = null;
  state.usernamePending = null;
  state.usernameLoading = false;
  state.usernameEditorOpen = false;
  state.usernameDraft = '';
  state.usernameError = '';
  state.usernameStatus = null;
}

function beginUsernameEdit() {
  const account = activeAccount();
  if (!account || state.usernameLoading) return;
  state.usernameEditorOpen = true;
  state.usernameDraft = account.username;
  state.usernameError = '';
  state.usernameStatus = null;
  render();
  app.querySelector('[name="newUsername"]')?.focus();
}

function cancelUsernameEdit() {
  if (state.usernameLoading) return;
  state.usernameEditorOpen = false;
  state.usernameDraft = '';
  state.usernameError = '';
  state.usernameStatus = null;
  render();
}

async function submitUsernameChange(form) {
  const generation = authGeneration;
  const account = activeAccount();
  if (!account || !['Fan', 'Artist'].includes(account.role)
    || form.dataset.userId !== account.id || !state.usernameEditorOpen || state.usernameLoading) return;

  const username = String(new FormData(form).get('newUsername') || '').trim().replace(/^@/, '').trim();
  let error = '';
  if (!username) error = 'Choose a username.';
  else if (state.accounts.some((entry) => entry.id !== account.id && entry.username.toLocaleLowerCase() === username.toLocaleLowerCase())) {
    error = 'That username is already in use.';
  }
  state.usernameDraft = username;
  state.usernameError = error;
  state.usernameStatus = null;
  if (error) {
    render();
    app.querySelector('[name="newUsername"]')?.focus();
    return;
  }

  state.usernamePending = { userId: account.id, username };
  state.usernameLoading = true;
  render();
  try {
    await persistAction('profile.username', { username });
    if (generation !== authGeneration) return;
    state.usernameEditorOpen = false;
    state.usernameDraft = '';
    state.usernameError = '';
    state.usernameStatus = { userId: account.id, message: 'Your username has been updated.' };
  } catch (error) {
    if (generation !== authGeneration) return;
    state.usernameError = error.message || 'That username could not be saved.';
  } finally {
    if (generation !== authGeneration) return;
    state.usernamePending = null;
    state.usernameTimer = null;
    state.usernameLoading = false;
    render();
  }
}

async function submitProfile(form) {
  const generation = authGeneration;
  const account = activeAccount();
  if (!account || account.role !== 'Fan' || !state.editingProfile || state.profileLoading || state.usernameLoading) return;
  const formData = new FormData(form);
  const name = String(formData.get('profileName') || '').trim();
  const biography = String(formData.get('profileBiography') || '').trim();
  const interests = String(formData.get('profileInterests') || '').trim();
  const errors = {};
  if (!name) errors.name = 'Enter a display name.';
  else if (name.length > 80) errors.name = 'Display names must be 80 characters or fewer.';
  if (biography.length > 500) errors.biography = 'Biographies must be 500 characters or fewer.';
  if (interests.length > 200) errors.interests = 'Artistic interests must be 200 characters or fewer.';
  if (state.profileImageLoading) state.profileError = 'Wait for the profile image to finish loading.';
  else state.profileError = '';
  state.profileDraft = { ...(state.profileDraft || {}), name, biography, interests };
  state.profileFieldErrors = errors;
  if (Object.keys(errors).length || state.profileError) {
    render();
    app.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  const values = {
    name,
    biography,
    interests,
    profileImage: state.profileDraft.profileImage || '',
    profileImageAssetId: state.profileDraft.profileImageAssetId || null,
  };
  state.profilePending = { userId: account.id, values };
  state.profileLoading = true;
  state.profileError = '';
  render();
  try {
    await persistAction('profile.update', {
      name,
      biography,
      interests,
      profileImageAssetId: values.profileImageAssetId,
    });
    if (generation !== authGeneration) return;
    state.profileStatus = { userId: account.id, message: 'Your profile has been updated.' };
    state.profileDraft = null;
    state.profileFieldErrors = {};
    state.profileImageError = '';
    state.editingProfile = false;
  } catch (error) {
    if (generation !== authGeneration) return;
    state.profileError = error.message || 'Your profile could not be saved.';
  } finally {
    if (generation !== authGeneration) return;
    state.profilePending = null;
    state.profileTimer = null;
    state.profileLoading = false;
    render();
  }
}

function selectProfileImage(input) {
  const account = activeAccount();
  const file = input.files?.[0];
  if (!account || account.role !== 'Fan' || !state.editingProfile || state.profileLoading || !file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    state.profileImageError = 'Choose a PNG, JPG, or WebP image.';
    render();
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    state.profileImageError = 'Choose an image smaller than 4 MB.';
    render();
    return;
  }
  state.profileImageError = '';
  state.profileImageLoading = true;
  const token = ++state.profileImageToken;
  const localUrl = URL.createObjectURL(file);
  state.profileDraft = {
    ...(state.profileDraft || {}),
    profileImage: localUrl,
    profileImageAssetId: null,
  };
  render();
  void uploadFile(file, 'profile').then((uploaded) => {
    if (token !== state.profileImageToken || !state.profileDraft) return;
    URL.revokeObjectURL(localUrl);
    state.profileDraft = {
      ...state.profileDraft,
      profileImage: uploaded.mediaUrl,
      profileImageAssetId: uploaded.assetId,
    };
    state.profileImageLoading = false;
    render();
  }).catch((error) => {
    if (token !== state.profileImageToken || !state.profileDraft) return;
    URL.revokeObjectURL(localUrl);
    state.profileDraft = {
      ...state.profileDraft,
      profileImage: '',
      profileImageAssetId: null,
    };
    state.profileImageError = error.message || 'The selected image could not be uploaded.';
    state.profileImageLoading = false;
    render();
  });
}

function render() {
  if (!app) return;
  unmountAuthWidget();
  const account = activeAccount();
  if (state.route === '/register') {
    app.innerHTML = renderRegistration();
    if (state.pendingRole || state.draft.role) mountAuthWidget('sign-up', 'clerk-sign-up');
    return;
  }
  if (state.route === '/login') {
    app.innerHTML = renderLogin();
    mountAuthWidget('sign-in', 'clerk-sign-in');
    return;
  }
  if (state.route === '/recover') {
    app.innerHTML = settings.renderRecover();
    settings.afterRender();
    return;
  }
  if (state.route === '/deletion-status') {
    app.innerHTML = settings.renderDeletionStatus();
    settings.afterRender();
    return;
  }
  if (state.route === '/settings' && !state.authLoading && !state.dataLoading && !state.activeAccountId) {
    navigate(state.authUserId ? '/profile/setup' : '/login', { replace: true });
    return;
  }
  if (state.route === '/profile/setup') {
    if (!state.authUserId && !state.authLoading) {
      navigate('/login', { replace: true });
      return;
    }
    app.innerHTML = renderProfileSetup();
    return;
  }
  if (state.route === '/confirmation' && state.successAccountId) {
    app.innerHTML = renderConfirmation();
    return;
  }
  if (state.dataLoading) {
    app.innerHTML = renderShell(
      `<section class="feed-loading" role="status" aria-live="polite" aria-busy="true"><span class="loading-dot"></span><p>Loading Stillroom…</p></section>`,
      'Feed',
    );
    return;
  }
  if (state.route === '/') {
    state.route = '/home';
    history.replaceState({}, '', hrefFor('/home'));
  }

  const boardRoute = parseBoardRoute(state.route);
  curation.ensure();
  const postRoute = state.route.match(/^\/post\/([^/]+)$/);
  const publicProfileRoute = state.route.match(/^\/profile\/([^/]+)$/);
  const shelfEditRoute = state.route.match(/^\/shelves\/([^/]+)\/edit$/);
  const shelfDetailRoute = state.route.match(/^\/shelves\/([^/]+)$/);
  const specialRoute = ['/artists', '/artists/new', '/artists/edit', '/shelves/new', '/settings'].includes(state.route)
    || Boolean(boardRoute) || Boolean(postRoute) || Boolean(publicProfileRoute) || Boolean(shelfEditRoute) || Boolean(shelfDetailRoute);
  if (!navItems.some((item) => item.path === state.route) && !specialRoute) state.route = '/home';
  let content;
  let title;
  if (state.route === '/home') { content = renderHome(); title = 'Feed'; }
  else if (state.route === '/explore') { content = renderExplore(); title = 'Explore'; }
  else if (state.route === '/artists') { content = renderArtists(); title = 'My Artists'; }
  else if (state.route === '/artists/new') { content = renderBoardForm('create'); title = 'Create your board'; }
  else if (state.route === '/artists/edit') { content = renderBoardForm('edit'); title = 'Edit your board'; }
  else if (boardRoute) {
    const { boardId, collectionId } = boardRoute;
    const board = state.boards.find((entry) => entry.id === boardId);
    content = renderBoardDetail(boardId, collectionId);
    title = board?.artistName || 'Artist board';
  }
  else if (postRoute) {
    let postId = postRoute[1];
    try { postId = decodeURIComponent(postId); } catch { /* Keep the unmatched route in the not-found state. */ }
    const post = state.posts.find((entry) => entry.id === postId);
    const board = post && state.boards.find((entry) => entry.id === post.boardId);
    content = board
      ? renderBoardDetail(board.id)
      : `<section><p class="eyebrow">Fan post</p><h1 class="page-title">Post not found.</h1><p class="page-subtitle">This post isn’t available in this session.</p>${renderEmpty('No post found.')}<div class="empty-action"><a class="quiet-button" href="${hrefFor('/explore')}" data-route="/explore">Back to Explore ${icon('arrow', 14)}</a></div></section>`;
    title = board?.artistName || 'Fan post';
  }
  else if (publicProfileRoute) {
    let profileId = publicProfileRoute[1];
    try { profileId = decodeURIComponent(profileId); } catch { /* Keep the unmatched route in the not-found state. */ }
    const profile = state.accounts.find((entry) => entry.id === profileId);
    content = renderPublicProfile(profileId);
    title = profile?.name || 'Member profile';
  }
  else if (state.route === '/shelves/new') { content = renderShelfForm('create'); title = 'Create a Shelf'; }
  else if (shelfEditRoute) {
    let shelfId = shelfEditRoute[1];
    try { shelfId = decodeURIComponent(shelfId); } catch { /* Keep the unmatched route in the not-found state. */ }
    content = renderShelfForm('edit', shelfId);
    title = 'Edit Shelf';
  }
  else if (shelfDetailRoute && shelfDetailRoute[1] !== 'new') {
    let shelfId = shelfDetailRoute[1];
    try { shelfId = decodeURIComponent(shelfId); } catch { /* Keep the unmatched route in the not-found state. */ }
    const shelf = state.shelves.find((entry) => entry.id === shelfId);
    content = renderShelfDetail(shelfId);
    title = shelf?.title || 'Personal Shelf';
  }
  else if (state.route === '/shelves') { content = renderShelves(); title = 'My Space'; }
  else if (state.route === '/profile') { content = renderProfile(); title = 'Profile'; }
  else if (state.route === '/settings') { content = settings.renderSettings(); title = 'Settings'; }
  else { content = renderHome(); title = 'Feed'; }
  app.innerHTML = renderShell(content, title);
  curation.afterRender();
  if (state.route === '/home') app.querySelector('.page-content')?.insertAdjacentHTML('afterbegin', settings.renderHomeNotice());
  if (state.dataError) {
    const main = app.querySelector('.page-content');
    if (main) {
      main.insertAdjacentHTML('afterbegin', `<div class="app-data-error" role="alert"><span>${escapeHTML(state.dataError)}</span><button class="text-button" type="button" data-action="retry-data">Retry</button></div>`);
    }
  }
  if (postRoute) {
    let postId = postRoute[1];
    try { postId = decodeURIComponent(postId); } catch { /* Leave the board at its normal scroll position. */ }
    requestAnimationFrame(() => {
      const target = document.getElementById(`post-card-${postId}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('post-open-highlight');
        window.setTimeout(() => target.classList.remove('post-open-highlight'), 1600);
      }
    });
  }
}

function beginRegistration(role = null) {
  if (clerk?.isSignedIn && state.authUserId && !state.activeAccountId) {
    navigate('/profile/setup');
    return;
  }
  state.pendingRole = role;
  state.draft.role = role;
  state.draft.name = '';
  state.draft.username = '';
  if (role === 'Fan' || role === 'Artist') {
    window.sessionStorage.setItem('stillroom.pendingRole', role);
  } else {
    window.sessionStorage.removeItem('stillroom.pendingRole');
  }
  state.errors = {};
  state.successAccountId = null;
  navigate('/register');
}

async function submitProfileSetup(form) {
  if (!state.authUserId || state.profileSetupLoading) return;
  const formData = new FormData(form);
  const name = String(formData.get('name') || '').trim();
  const usernameInput = String(formData.get('username') || '').trim();
  const username = usernameInput.replace(/^@/, '').trim();
  const errors = {};
  if (!state.draft.role || !['Fan', 'Artist'].includes(state.draft.role)) {
    errors.role = 'Choose whether you’re joining as a Fan or Artist.';
  }
  if (!name) errors.name = 'Enter your name.';
  else if (name.length > 100) errors.name = 'Names must be 100 characters or fewer.';
  if (!username) errors.username = 'Choose a username.';
  else if (username.length > 32) errors.username = 'Usernames must be 32 characters or fewer.';
  else if (state.accounts.some((account) =>
    account.id !== state.authUserId
    && account.username.toLocaleLowerCase() === username.toLocaleLowerCase())) {
    errors.username = 'That username is already in use.';
  }
  state.draft = { ...state.draft, name, username: usernameInput };
  state.errors = errors;
  state.profileSetupError = '';
  if (Object.keys(errors).length) {
    render();
    app.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  state.profileSetupLoading = true;
  const generation = authGeneration;
  render();
  try {
    const result = await createProfile({ role: state.draft.role, name, username });
    if (generation !== authGeneration) return;
    const data = await getBootstrap();
    if (generation !== authGeneration) return;
    applyBootstrap(data);
    state.successAccountId = result.profile.id;
    state.pendingRole = null;
    state.profileSetupLoading = false;
    state.profileSetupError = '';
    window.sessionStorage.removeItem('stillroom.pendingRole');
    state.draft = { role: null, name: '', username: '', email: '' };
    navigate('/confirmation', { replace: true });
  } catch (error) {
    if (generation !== authGeneration) return;
    state.profileSetupLoading = false;
    state.profileSetupError = error.message || 'Your profile could not be created.';
    if (error.status === 409) state.errors.username = error.message;
    render();
  }
}

function beginBoardForm(mode) {
  const account = activeAccount();
  if (!account || account.role !== 'Artist') {
    navigate(mode === 'edit' ? '/artists/edit' : '/artists/new');
    return;
  }
  const existing = boardForOwner(account.id);
  state.boardDraft = mode === 'edit' && existing
    ? boardDraftFrom(existing)
    : boardDraftFrom(null, account);
  state.boardCoverToken += 1;
  state.boardCoverLoading = false;
  state.boardCoverError = '';
  state.boardErrors = {};
  state.boardImageError = '';
  state.boardImageLoading = false;
  state.boardImageReadToken += 1;
  state.boardSuccess = '';
  state.boardSuccessId = null;
  navigate(mode === 'edit' ? '/artists/edit' : '/artists/new');
}

async function submitBoard(form) {
  const generation = authGeneration;
  const account = activeAccount();
  const mode = form.dataset.mode;
  const existing = account?.role === 'Artist' ? boardForOwner(account.id) : null;
  const formData = new FormData(form);
  const artistName = String(formData.get('artistName') || '').trim();
  const discipline = String(formData.get('discipline') || '').trim();
  const biography = String(formData.get('biography') || '').trim();
  const errors = {};

  if (!account || account.role !== 'Artist') errors.form = 'Only Artist accounts can create or edit boards.';
  if (mode === 'create' && existing) errors.form = 'Each Artist account can create only one personal board.';
  if (mode === 'edit' && (!existing || existing.ownerId !== account?.id)) errors.form = 'You can only edit a board you own.';
  if (!artistName) errors.artistName = 'Enter the artist name for this board.';
  if (!discipline) errors.discipline = 'Add an artistic discipline.';
  if (!biography) errors.biography = 'Add a short biography.';
  const creativeDescription = String(formData.get('creativeDescription') || '').trim();
  if (creativeDescription.length > 240) errors.creativeDescription = 'Keep the creative description to 240 characters or fewer.';
  if (state.boardCoverLoading) errors.form = 'Wait for the cover image to finish uploading.';

  state.boardDraft = { ...(state.boardDraft || {}), artistName, discipline, biography, creativeDescription };
  state.boardErrors = errors;
  if (Object.keys(errors).length) {
    render();
    app.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  const board = {
    ownerId: account.id,
    artistName,
    discipline,
    biography,
    profileImage: state.boardDraft.profileImage || '',
    profileImageAssetId: state.boardDraft.profileImageAssetId || null,
  };
  state.pendingBoard = { mode, board };
  state.boardLoading = true;
  render();
  try {
    const data = await persistAction('board.save', {
      artistName,
      discipline,
      biography,
      profileImageAssetId: board.profileImageAssetId,
      coverImageAssetId: state.boardDraft.coverImage ? state.boardDraft.coverImageAssetId || null : null,
      creativeDescription,
    });
    if (generation !== authGeneration) return;
    const savedBoard = data.boards.find((entry) => entry.ownerId === account.id);
    if (!savedBoard) throw new Error('The board could not be found after saving.');
    state.boardSuccess = mode === 'edit' ? 'Board information saved.' : 'Your artist board is ready.';
    state.boardSuccessId = savedBoard.id;
    state.pendingBoard = null;
    state.boardTimer = null;
    state.boardLoading = false;
    state.boardDraft = null;
    state.boardErrors = {};
    navigate(`/board/${encodeURIComponent(savedBoard.id)}`, { replace: true });
  } catch (error) {
    if (generation !== authGeneration) return;
    state.boardErrors = { form: error.message || 'Your artist board could not be saved.' };
    state.pendingBoard = null;
    state.boardTimer = null;
    state.boardLoading = false;
    render();
  }
}

function startPostComposer(boardId, postId = null) {
  const account = activeAccount();
  const board = state.boards.find((entry) => entry.id === boardId);
  if (!account || account.role !== 'Fan' || !board || state.postPublishing) return;
  const existing = postId ? state.posts.find((post) => post.id === postId && post.boardId === board.id) : null;
  if (postId && (!existing || existing.authorId !== account.id)) return;
  const key = postDraftKey(account.id, board.id, existing?.id || null);
  if (!state.postDrafts[key]) {
    state.postDrafts[key] = existing
      ? { authorId: account.id, boardId: board.id, postId: existing.id, content: existing.content, media: existing.media }
      : { authorId: account.id, boardId: board.id, postId: null, content: '', media: null };
  }
  state.postEditor = { boardId: board.id, postId: existing?.id || null, authorId: account.id, key };
  state.postErrors[key] = '';
  state.postStatus = null;
  state.deleteConfirmPostId = null;
  navigate(`/board/${encodeURIComponent(board.id)}`);
}

async function toggleArtistFollow(boardId) {
  const generation = authGeneration;
  const account = activeAccount();
  const board = state.boards.find((entry) => entry.id === boardId);
  if (account?.role !== 'Fan' || !board || state.followStatus?.pending) return;

  const current = followedArtistIds(account.id);
  const following = current.includes(board.ownerId);
  state.followStatus = { boardId: board.id, userId: account.id, pending: true, message: 'Updating My Artists…' };
  render();
  try {
    await persistAction('follow.toggle', { artistId: board.id });
    if (generation !== authGeneration) return;
    state.followStatus = {
      boardId: board.id,
      userId: account.id,
      message: following ? `${board.artistName} removed from My Artists.` : `${board.artistName} added to My Artists.`,
    };
  } catch (error) {
    if (generation !== authGeneration) return;
    state.followStatus = { boardId: board.id, userId: account.id, kind: 'error', message: error.message || 'My Artists could not be updated.' };
  }
  render();
}

function toggleComments(postId) {
  const post = state.posts.find((entry) => entry.id === postId);
  if (!post) return;
  state.expandedCommentPostIds = state.expandedCommentPostIds.includes(postId)
    ? state.expandedCommentPostIds.filter((entry) => entry !== postId)
    : [...state.expandedCommentPostIds, postId];
  render();
  if (state.expandedCommentPostIds.includes(postId)) {
    void loadCommentPage(postId);
    if (!activeAccount()) openInteractionPrompt('comment', postId);
  }
}

let commentReadSequence = 0;
async function loadCommentPage(postId, earlier = false) {
  if (state.commentReaders[postId]) return;
  const cursor = earlier ? state.commentPagination[postId]?.nextCursor : undefined;
  if (earlier && !cursor) return;
  const generation = authGeneration;
  const request = ++commentReadSequence;
  state.commentReaders[postId] = request;
  state.commentReadErrors[postId] = '';
  render();
  try {
    const data = await getComments(postId, cursor);
    if (generation !== authGeneration || state.commentReaders[postId] !== request || !state.posts.some((post) => post.id === postId)) return;
    const previous = earlier ? state.comments.filter((comment) => comment.postId === postId) : [];
    const comments = [...new Map([...previous, ...data.comments].map((comment) => [comment.id, comment])).values()]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, 100);
    state.comments = [...state.comments.filter((comment) => comment.postId !== postId), ...comments];
    state.commentPagination[postId] = data.pagination;
    state.commentWindows[postId] = earlier;
  } catch (error) {
    if (generation === authGeneration && state.commentReaders[postId] === request) state.commentReadErrors[postId] = error.message || 'Comments could not be loaded.';
  } finally {
    if (generation === authGeneration && state.commentReaders[postId] === request) {
      delete state.commentReaders[postId];
      render();
    }
  }
}

async function submitComment(form) {
  const generation = authGeneration;
  const account = activeAccount();
  const post = state.posts.find((entry) => entry.id === form.dataset.postId && isVisibleFanPost(entry));
  const commentId = form.dataset.commentId || null;
  if (!canComment(account) || !post || state.commentPending) return;
  delete state.commentReaders[post.id];

  const existing = commentId
    ? state.comments.find((entry) => entry.id === commentId && entry.postId === post.id && entry.authorId === account.id)
    : null;
  const key = commentId || commentDraftKey(account.id, post.id);
  const content = String(new FormData(form).get('commentContent') || '').trim();
  const error = !content
    ? 'Write a comment before posting.'
    : content.length > 1000
      ? 'Comments must be 1,000 characters or fewer.'
      : commentId && !existing
        ? 'You can only edit your own comments.'
        : '';

  if (commentId && state.commentEditor?.commentId === commentId) state.commentEditor.content = content;
  else if (!commentId) state.commentDrafts[commentDraftKey(account.id, post.id)] = content;
  state.commentErrors[key] = error;
  if (error) {
    render();
    app.querySelector('[name="commentContent"]')?.focus();
    return;
  }

  state.commentErrors[key] = '';
  state.commentPending = {
    action: commentId ? 'edit' : 'create',
    userId: account.id,
    postId: post.id,
    commentId,
    content,
    draftKey: commentDraftKey(account.id, post.id),
  };
  state.commentStatus = null;
  render();
  try {
    await persistAction('comment.save', {
      commentId,
      postId: post.id,
      content,
    });
    if (generation !== authGeneration) return;
    if (!commentId) delete state.commentDrafts[key];
    delete state.commentErrors[key];
    state.commentEditor = null;
    state.commentStatus = {
      userId: account.id,
      postId: post.id,
      kind: 'success',
      message: commentId ? 'Comment updated.' : 'Comment posted.',
    };
  } catch (error) {
    if (generation !== authGeneration) return;
    state.commentStatus = {
      userId: account.id,
      postId: post.id,
      kind: 'error',
      message: error.message || 'This comment could not be saved.',
    };
  } finally {
    if (generation !== authGeneration) return;
    state.commentPending = null;
    state.commentTimer = null;
    if (!state.expandedCommentPostIds.includes(post.id)) state.expandedCommentPostIds.push(post.id);
    render();
  }
}

function beginCommentEdit(commentId) {
  const account = activeAccount();
  const comment = state.comments.find((entry) => entry.id === commentId);
  if (!canComment(account) || comment?.authorId !== account.id || state.commentPending) return;
  state.commentEditor = { commentId, postId: comment.postId, userId: account.id, content: comment.content };
  state.expandedCommentPostIds = [...new Set([...state.expandedCommentPostIds, comment.postId])];
  delete state.commentErrors[commentId];
  render();
}

function cancelCommentEdit() {
  if (state.commentPending) return;
  if (state.commentEditor) delete state.commentErrors[state.commentEditor.commentId];
  state.commentEditor = null;
  render();
}

function requestDeleteComment(commentId) {
  const account = activeAccount();
  const comment = state.comments.find((entry) => entry.id === commentId);
  if (!canComment(account) || comment?.authorId !== account.id || state.commentPending) return;
  state.commentDeleteConfirmId = comment.id;
  state.expandedCommentPostIds = [...new Set([...state.expandedCommentPostIds, comment.postId])];
  render();
}

async function confirmDeleteComment(commentId) {
  const generation = authGeneration;
  const account = activeAccount();
  const comment = state.comments.find((entry) => entry.id === commentId);
  if (!canComment(account) || comment?.authorId !== account.id || state.commentPending || state.commentDeleteConfirmId !== commentId) return;
  delete state.commentReaders[comment.postId];
  state.commentPending = { action: 'delete', userId: account.id, postId: comment.postId, commentId };
  state.commentDeleteConfirmId = null;
  state.commentStatus = null;
  render();
  try {
    await persistAction('comment.delete', { commentId });
    if (generation !== authGeneration) return;
    delete state.commentErrors[commentId];
    if (state.commentEditor?.commentId === commentId) state.commentEditor = null;
    state.commentStatus = { userId: account.id, postId: comment.postId, kind: 'success', message: 'Comment deleted.' };
  } catch (error) {
    if (generation !== authGeneration) return;
    state.commentStatus = {
      userId: account.id,
      postId: comment.postId,
      kind: 'error',
      message: error.message || 'This comment could not be deleted.',
    };
  } finally {
    if (generation !== authGeneration) return;
    state.commentPending = null;
    state.commentTimer = null;
    render();
  }
}

function toggleRepost(postId) {
  const account = activeAccount();
  const post = state.posts.find((entry) => entry.id === postId && isVisibleFanPost(entry));
  if (account?.role !== 'Fan' || !post || state.repostPending) return;
  const existing = state.reposts.find((entry) => entry.userId === account.id && entry.postId === post.id);
  state.repostConfirm = { action: existing ? 'undo' : 'create', userId: account.id, postId: post.id };
  state.repostStatus = null;
  render();
}

function cancelRepost() {
  if (state.repostPending) return;
  state.repostConfirm = null;
  render();
}

async function confirmRepost(postId) {
  const generation = authGeneration;
  const account = activeAccount();
  const confirmation = state.repostConfirm;
  const post = state.posts.find((entry) => entry.id === postId && isVisibleFanPost(entry));
  if (account?.role !== 'Fan' || !post || state.repostPending || confirmation?.postId !== postId || confirmation?.userId !== account.id) return;
  const existing = state.reposts.find((entry) => entry.userId === account.id && entry.postId === postId);
  if (confirmation.action === 'create' && existing) {
    state.repostConfirm = null;
    state.repostStatus = { userId: account.id, postId, kind: 'error', message: 'You have already reposted this post.' };
    render();
    return;
  }
  if (confirmation.action === 'undo' && !existing) {
    state.repostConfirm = null;
    state.repostStatus = { userId: account.id, postId, kind: 'error', message: 'Your repost is no longer available.' };
    render();
    return;
  }
  state.repostPending = { action: confirmation.action, userId: account.id, postId, repostId: existing?.id || null };
  state.repostConfirm = null;
  state.repostStatus = null;
  render();
  try {
    await persistAction('repost.set', { postId, active: confirmation.action !== 'undo' });
    if (generation !== authGeneration) return;
    state.repostStatus = {
      userId: account.id,
      postId,
      kind: 'success',
      message: confirmation.action === 'create' ? 'Repost added to your profile.' : 'Your repost was removed.',
    };
  } catch (error) {
    if (generation !== authGeneration) return;
    state.repostStatus = {
      userId: account.id,
      postId,
      kind: 'error',
      message: error.message || 'This repost could not be completed.',
    };
  } finally {
    if (generation !== authGeneration) return;
    state.repostPending = null;
    state.repostTimer = null;
    render();
  }
}

async function saveCurrentPostDraft() {
  const generation = authGeneration;
  const editor = state.postEditor;
  const account = activeAccount();
  const draft = editor && state.postDrafts[editor.key];
  if (!editor || !draft || account?.role !== 'Fan' || editor.authorId !== account.id || state.postMediaLoading) return;
  state.postPublishing = true;
  render();
  try {
    await persistAction('draft.save', {
      boardId: editor.boardId,
      postId: editor.postId || null,
      content: draft.content || '',
      mediaAssetId: draft.media?.assetId || null,
    });
    if (generation !== authGeneration) return;
    state.postEditor = null;
    state.postErrors[editor.key] = '';
    state.postStatus = { boardId: editor.boardId, userId: account.id, message: 'Draft saved.' };
  } catch (error) {
    if (generation !== authGeneration) return;
    state.postErrors[editor.key] = error.message || 'Your draft could not be saved.';
  } finally {
    if (generation !== authGeneration) return;
    state.postPublishing = false;
    render();
  }
}

async function discardPostDraft(authorId, boardId, postId = null) {
  const generation = authGeneration;
  const key = postDraftKey(authorId, boardId, postId);
  const draft = state.postDrafts[key];
  if (state.postPublishing) return;
  state.postPublishing = true;
  render();
  try {
    await persistAction('draft.delete', { boardId, postId });
    if (generation !== authGeneration) return;
    releaseDraftMedia(draft);
    delete state.postDrafts[key];
    delete state.postErrors[key];
    if (state.postEditor?.key === key) state.postEditor = null;
    state.postStatus = { boardId, userId: authorId, message: 'Draft discarded.' };
  } catch (error) {
    if (generation !== authGeneration) return;
    state.postErrors[key] = error.message || 'Your draft could not be discarded.';
  } finally {
    if (generation !== authGeneration) return;
    state.postPublishing = false;
    render();
  }
}

async function deletePost(postId) {
  const generation = authGeneration;
  const account = activeAccount();
  const post = state.posts.find((entry) => entry.id === postId);
  if (!account || account.role !== 'Fan' || !post || post.authorId !== account.id
    || (state.postPublishing && state.pendingPost?.postId === post.id)
    || state.commentPending?.postId === post.id || state.repostPending?.postId === post.id) return;

  state.postPublishing = true;
  state.postStatus = null;
  render();
  try {
    await persistAction('post.delete', { postId });
    if (generation !== authGeneration) return;
  } catch (error) {
    if (generation !== authGeneration) return;
    state.postPublishing = false;
    state.postStatus = { boardId: post.boardId, userId: account.id, kind: 'error', message: error.message || 'This post could not be deleted.' };
    render();
    return;
  }
  state.postPublishing = false;
  for (const [key, draft] of Object.entries(state.postDrafts)) {
    if (draft.postId === post.id) {
      releaseDraftMedia(draft);
      delete state.postDrafts[key];
      delete state.postErrors[key];
    }
  }
  if (post.media?.url?.startsWith('blob:')) URL.revokeObjectURL(post.media.url);
  const deletedCommentIds = new Set(state.comments.filter((entry) => entry.postId === post.id).map((entry) => entry.id));
  state.posts = state.posts.filter((entry) => entry.id !== post.id);
  state.reposts = state.reposts.filter((entry) => entry.postId !== post.id);
  state.comments = state.comments.filter((entry) => entry.postId !== post.id);
  for (const commentId of deletedCommentIds) delete state.commentErrors[commentId];
  for (const key of Object.keys(state.commentDrafts)) {
    if (key.endsWith(`::${post.id}`)) {
      delete state.commentDrafts[key];
      delete state.commentErrors[key];
    }
  }
  state.expandedCommentPostIds = state.expandedCommentPostIds.filter((entry) => entry !== post.id);
  if (state.commentEditor?.postId === post.id) state.commentEditor = null;
  if (deletedCommentIds.has(state.commentDeleteConfirmId)) state.commentDeleteConfirmId = null;
  if (state.commentStatus?.postId === post.id) state.commentStatus = null;
  if (state.repostConfirm?.postId === post.id) state.repostConfirm = null;
  if (state.repostStatus?.postId === post.id) state.repostStatus = null;
  state.shelves = state.shelves.map((shelf) => shelf.postIds.includes(post.id)
    ? { ...shelf, postIds: shelf.postIds.filter((savedId) => savedId !== post.id) }
    : shelf);
  if (state.postEditor?.postId === post.id) state.postEditor = null;
  state.deleteConfirmPostId = null;
  state.postStatus = { boardId: post.boardId, userId: account.id, message: 'Post deleted.' };
  render();
}

async function submitPost(form) {
  const generation = authGeneration;
  const account = activeAccount();
  const board = state.boards.find((entry) => entry.id === form.dataset.boardId);
  const postId = form.dataset.postId || null;
  const existing = postId ? state.posts.find((post) => post.id === postId && post.boardId === board?.id) : null;
  if (!account || account.role !== 'Fan' || !board) return;

  const key = postDraftKey(account.id, board.id, postId);
  const draft = state.postDrafts[key] || { authorId: account.id, boardId: board.id, postId, content: '', media: null };
  const formData = new FormData(form);
  const content = String(formData.get('postContent') || '');
  const errors = {};

  if (state.postMediaLoading || draft.media?.uploading) errors.form = 'Wait for your media to finish uploading.';
  if (postId && (!existing || existing.authorId !== account.id)) errors.form = 'You can only edit your own posts.';
  if (state.postErrors[key]) errors.form = state.postErrors[key];
  if (!errors.form && content.length > 2000) errors.form = 'Posts must be 2,000 characters or fewer.';
  if (!errors.form && !content.trim() && !draft.media) errors.form = 'Add text or attach an image or video before publishing.';

  state.postDrafts[key] = { ...draft, content };
  state.postErrors[key] = errors.form || '';
  if (Object.keys(errors).length) {
    render();
    app.querySelector('[data-post-content]')?.focus();
    return;
  }

  const post = {
    id: existing?.id || null,
    boardId: board.id,
    authorId: account.id,
    authorUsername: account.username,
    content: content.trim(),
    media: draft.media ? { ...draft.media, isNew: false } : null,
    publishedAt: existing?.publishedAt || Date.now(),
  };
  state.pendingPost = { key, postId: existing?.id || null, boardId: board.id, authorId: account.id, post };
  state.postPublishing = true;
  if (!existing) state.contentPage = 0;
  render();
  try {
    await persistAction('post.save', {
      postId: existing?.id || null,
      boardId: board.id,
      content: content.trim(),
      mediaAssetId: draft.media?.assetId || null,
    });
    if (generation !== authGeneration) return;
    delete state.postDrafts[key];
    delete state.postErrors[key];
    if (state.postEditor?.key === key) state.postEditor = null;
    state.postStatus = {
      boardId: board.id,
      userId: account.id,
      message: existing ? 'Your changes have been published.' : 'Your post is live.',
    };
    state.homeTab = 'for-you';
  } catch (error) {
    if (generation !== authGeneration) return;
    state.postErrors[key] = error.message || 'Your post could not be published.';
  } finally {
    if (generation !== authGeneration) return;
    state.postPublishing = false;
    state.pendingPost = null;
    state.postTimer = null;
    state.deleteConfirmPostId = null;
    render();
  }
}

async function selectPostMedia(input) {
  const account = activeAccount();
  const editor = state.postEditor;
  const file = input.files?.[0];
  if (!account || account.role !== 'Fan' || !editor || editor.authorId !== account.id || !file) return;
  const key = editor.key;
  const draft = state.postDrafts[key];
  const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const videoTypes = ['video/mp4', 'video/webm'];
  const type = imageTypes.includes(file.type) ? 'image' : videoTypes.includes(file.type) ? 'video' : null;
  const errors = type
    ? ''
    : 'Choose a PNG, JPG, WebP, GIF, MP4, or WebM file.';
  if (errors) {
    state.postErrors[key] = errors;
    render();
    return;
  }
  const maxBytes = type === 'image' ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
  if (file.size === 0) {
    state.postErrors[key] = 'The selected file is empty.';
    render();
    return;
  }
  if (file.size > maxBytes) {
    state.postErrors[key] = type === 'image' ? 'Images must be 10 MB or smaller.' : 'Videos must be 25 MB or smaller.';
    render();
    return;
  }

  const token = ++state.postMediaToken;
  let previewUrl;
  try {
    previewUrl = URL.createObjectURL(file);
  } catch {
    state.postErrors[key] = 'This file could not be prepared. Try another file.';
    render();
    return;
  }
  releaseDraftMedia(draft);
  state.postDrafts[key] = {
    ...draft,
    media: { url: previewUrl, type, name: file.name, size: file.size, isNew: true, uploading: true },
  };
  state.postErrors[key] = '';
  state.postMediaError = '';
  state.postMediaLoading = true;
  state.postUploadProgress = 0;
  render();
  try {
    const uploaded = await uploadFile(file, 'post', (progress) => {
      if (token !== state.postMediaToken) return;
      state.postUploadProgress = progress;
      const meter = app.querySelector('[data-post-upload-progress]');
      const label = app.querySelector('[data-post-upload-label]');
      if (meter) meter.value = progress;
      if (label) label.textContent = progress === 100 ? 'Verifying upload…' : `Uploading media securely… ${progress}%`;
    });
    if (token !== state.postMediaToken || !state.postDrafts[key]) {
      URL.revokeObjectURL(previewUrl);
      return;
    }
    URL.revokeObjectURL(previewUrl);
    const current = state.postDrafts[key];
    state.postDrafts[key] = {
      ...current,
      media: {
        assetId: uploaded.assetId,
        url: uploaded.mediaUrl,
        type,
        name: file.name,
        size: file.size,
        isNew: false,
      },
    };
    state.postMediaError = '';
  } catch (error) {
    if (token === state.postMediaToken) {
      URL.revokeObjectURL(previewUrl);
      const current = state.postDrafts[key];
      if (current) state.postDrafts[key] = { ...current, media: null };
      state.postErrors[key] = error.message || 'This file could not be uploaded.';
      state.postMediaError = state.postErrors[key];
    }
  } finally {
    if (token === state.postMediaToken) {
      state.postMediaLoading = false;
      render();
    }
  }
}

async function selectBoardImage(file) {
  if (!file || !state.boardDraft) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    state.boardImageError = 'Choose a PNG, JPG, or WebP image.';
    render();
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    state.boardImageError = 'Choose an image smaller than 4 MB.';
    render();
    return;
  }
  const token = ++state.boardImageReadToken;
  const localUrl = URL.createObjectURL(file);
  state.boardDraft = { ...state.boardDraft, profileImage: localUrl, profileImageAssetId: null };
  state.boardImageError = '';
  state.boardImageLoading = true;
  render();
  try {
    const uploaded = await uploadFile(file, 'board');
    if (token !== state.boardImageReadToken || !state.boardDraft) {
      URL.revokeObjectURL(localUrl);
      return;
    }
    URL.revokeObjectURL(localUrl);
    state.boardDraft = {
      ...state.boardDraft,
      profileImage: uploaded.mediaUrl,
      profileImageAssetId: uploaded.assetId,
    };
  } catch (error) {
    if (token === state.boardImageReadToken && state.boardDraft) {
      URL.revokeObjectURL(localUrl);
      state.boardDraft = { ...state.boardDraft, profileImage: '', profileImageAssetId: null };
      state.boardImageError = error.message || 'The selected image could not be uploaded.';
    }
  } finally {
    if (token === state.boardImageReadToken) {
      state.boardImageLoading = false;
      render();
    }
  }
}

async function selectBoardCover(file) {
  if (!state.boardDraft) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    state.boardCoverError = 'Choose a PNG, JPG, or WebP image.';
    render();
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    state.boardCoverError = 'Choose an image smaller than 4 MB.';
    render();
    return;
  }
  const token = ++state.boardCoverToken;
  const generation = authGeneration;
  const accountId = state.activeAccountId;
  const localUrl = URL.createObjectURL(file);
  state.boardDraft = { ...state.boardDraft, coverImage: localUrl, coverImageAssetId: null };
  state.boardCoverError = '';
  state.boardCoverLoading = true;
  render();
  const current = () => token === state.boardCoverToken && generation === authGeneration && accountId === state.activeAccountId && state.boardDraft;
  try {
    const uploaded = await uploadFile(file, 'board');
    if (!current()) return;
    state.boardDraft = { ...state.boardDraft, coverImage: uploaded.mediaUrl, coverImageAssetId: uploaded.assetId };
  } catch (error) {
    if (!current()) return;
    state.boardDraft = { ...state.boardDraft, coverImage: '', coverImageAssetId: null };
    state.boardCoverError = error.message || 'The cover image could not be uploaded.';
  } finally {
    URL.revokeObjectURL(localUrl);
    if (token === state.boardCoverToken) {
      state.boardCoverLoading = false;
      render();
    }
  }
}

window.addEventListener('keydown', (event) => {
  curation.handleKeydown(event);
});

app?.addEventListener('input', (event) => {
  const target = event.target;
  if (settings.handleInput(target)) return;
  if (target instanceof HTMLInputElement && ['name', 'username', 'email'].includes(target.name)) {
    state.draft[target.name] = target.value;
  }
  const profileField = target.name === 'profileName' ? 'name'
    : target.name === 'profileBiography' ? 'biography'
      : target.name === 'profileInterests' ? 'interests' : '';
  if (profileField && state.editingProfile && state.profileDraft) {
    state.profileDraft = { ...state.profileDraft, [profileField]: target.value };
    if (state.profileFieldErrors[profileField]) {
      delete state.profileFieldErrors[profileField];
      target.removeAttribute('aria-invalid');
      target.removeAttribute('aria-describedby');
      app.querySelector(`#profile-${profileField}-error`)?.remove();
    }
    state.profileError = '';
  }
  if (target instanceof HTMLInputElement && target.name === 'newUsername' && state.usernameEditorOpen) {
    state.usernameDraft = target.value;
    if (state.usernameError) {
      state.usernameError = '';
      target.removeAttribute('aria-invalid');
      target.removeAttribute('aria-describedby');
      app.querySelector('#username-change-error')?.remove();
    }
  }
  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
    && target.closest('form[data-form="shelf"]')
    && ['title', 'description', 'visibility'].includes(target.name)) {
    state.shelfDraft = { ...(state.shelfDraft || {}), [target.name]: target.value };
    if (state.shelfErrors[target.name]) {
      delete state.shelfErrors[target.name];
      target.removeAttribute('aria-invalid');
      target.removeAttribute('aria-describedby');
      app.querySelector(`#shelf-error-${target.name}`)?.remove();
    }
    if (state.shelfErrors.form) {
      delete state.shelfErrors.form;
      app.querySelector('.shelf-form-card > .inline-error')?.remove();
    }
  }
  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && ['artistName', 'discipline', 'biography', 'creativeDescription'].includes(target.name)) {
    if (target.name === 'creativeDescription') {
      const count = app.querySelector('#board-creative-count');
      if (count) count.textContent = `${target.value.length} / 240`;
    }
    state.boardDraft = { ...(state.boardDraft || {}), [target.name]: target.value };
    if (state.boardErrors[target.name]) {
      delete state.boardErrors[target.name];
      target.removeAttribute('aria-invalid');
      target.removeAttribute('aria-describedby');
      app.querySelector(`#board-error-${target.name}`)?.remove();
    }
    if (state.boardErrors.form) delete state.boardErrors.form;
  }
  if (target instanceof HTMLTextAreaElement && target.matches('[data-post-content]')) {
    const account = activeAccount();
    const form = target.closest('form[data-form="post"]');
    if (account?.role === 'Fan' && form) {
      const key = postDraftKey(account.id, form.dataset.boardId, form.dataset.postId || null);
      const draft = state.postDrafts[key];
      if (draft) state.postDrafts[key] = { ...draft, content: target.value };
      if (state.postErrors[key]) {
        state.postErrors[key] = '';
        target.removeAttribute('aria-invalid');
        app.querySelector('[data-post-error]')?.remove();
      }
    }
  }
  if (target instanceof HTMLTextAreaElement && target.name === 'commentContent') {
    const account = activeAccount();
    const form = target.closest('form[data-form="comment"]');
    if (account?.role === 'Fan' && form) {
      const commentId = form.dataset.commentId || null;
      const key = commentId || commentDraftKey(account.id, form.dataset.postId);
      if (commentId && state.commentEditor?.commentId === commentId) state.commentEditor.content = target.value;
      else if (!commentId) state.commentDrafts[key] = target.value;
      if (state.commentErrors[key]) {
        delete state.commentErrors[key];
        target.removeAttribute('aria-invalid');
        form.querySelector('.inline-error')?.remove();
      }
    }
  }
  if (target instanceof HTMLInputElement && target.matches('[data-explore-search]')) {
    state.exploreQuery = target.value;
    const clearButton = app.querySelector('[data-action="clear-explore-search"]');
    if (clearButton) clearButton.hidden = !state.exploreQuery;
    queueExploreSearch();
  }
});

app?.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.matches('[data-explore-discipline]')) {
    state.exploreDiscipline = target.value;
    queueExploreSearch();
    return;
  }
  if (settings.handleChange(target)) return;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.matches('input[name="shelfIds"]')) {
    state.shelfPickerSelection = [...app.querySelectorAll('input[name="shelfIds"]:checked')].map((input) => input.value);
    return;
  }
  if (target.matches('[data-post-media]')) {
    selectPostMedia(target);
    return;
  }
  if (target.matches('[data-profile-image]')) {
    void selectProfileImage(target);
    return;
  }
  if (target.matches('[data-board-cover]')) {
    const cover = target.files?.[0];
    if (cover) void selectBoardCover(cover);
    return;
  }
  if (!target.matches('[data-board-image]')) return;
  const file = target.files?.[0];
  if (file) void selectBoardImage(file);
});

app?.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (settings.handleSubmit(form)) return;
  if (form.dataset.form === 'profile-setup' && !state.profileSetupLoading) void submitProfileSetup(form);
  else if (form.dataset.form === 'board' && !state.boardLoading && !state.usernameLoading) submitBoard(form);
  else if (form.dataset.form === 'post' && !state.postPublishing) submitPost(form);
  else if (form.dataset.form === 'shelf' && !state.shelfLoading) submitShelfForm(form);
  else if (form.dataset.form === 'shelf-picker' && !state.shelfLoading) submitShelfPicker(form);
  else if (form.dataset.form === 'comment' && !state.commentPending) submitComment(form);
  else if (form.dataset.form === 'collection') curation.submitCollectionForm(form);
  else if (form.dataset.form === 'profile' && !state.profileLoading && !state.profileImageLoading) submitProfile(form);
  else if (form.dataset.form === 'username' && !state.usernameLoading) submitUsernameChange(form);
});

app?.addEventListener('click', (event) => {
  const clickedElement = event.target instanceof Element ? event.target : null;
  if (curation.handleBackdrop(clickedElement)) return;
  const shelfSignupBackdrop = clickedElement?.closest('.shelf-signup-backdrop');
  if (state.interactionPrompt && clickedElement?.classList.contains('interaction-backdrop')) {
    closeInteractionPrompt();
    return;
  }
  if (shelfSignupBackdrop && clickedElement === shelfSignupBackdrop) {
    closeShelfSignupPrompt();
    return;
  }
  const target = clickedElement?.closest('[data-action], [data-route]') || null;
  if (!target) return;
  if (target.matches('[data-route]')) {
    event.preventDefault();
    navigate(target.dataset.route);
    return;
  }

  const action = target.dataset.action;
  if (curation.handleClick(action, target)) return;
  if (settings.handleClick(action, target, event)) return;
  if (action === 'load-public-more') {
    if (state.contentRefreshing || publicEditorActive() || !state.contentPagination?.nextCursor) return;
    state.contentCursor = state.contentPagination.nextCursor;
    void refreshPublicContent({ append: true });
    return;
  }
  if (action === 'content-page' || action === 'refresh-public-content') {
    if (state.contentRefreshing || publicEditorActive()) return;
    state.contentPage = action === 'content-page' ? Number(target.dataset.page) : 0;
    state.contentCursor = null;
    void refreshPublicContent();
    return;
  }
  if (action === 'close-interaction-prompt') { closeInteractionPrompt(); return; }
  if (action === 'interaction-auth') {
    rememberInteraction(state.interactionPrompt);
    state.interactionPrompt = null;
    if (target.dataset.destination === 'login') navigate('/login');
    else beginRegistration(target.dataset.role || 'Fan');
    return;
  }
  if (['open-shelf-picker', 'toggle-repost', 'request-comment'].includes(action) && !activeAccount()) {
    openInteractionPrompt(action === 'open-shelf-picker' ? 'shelf' : action === 'toggle-repost' ? 'repost' : 'comment', target.dataset.postId);
    return;
  }
  if (action === 'earlier-comments' || action === 'retry-comments') {
    void loadCommentPage(target.dataset.postId, action === 'earlier-comments');
    return;
  }
  if (action === 'shelf-page') {
    if (state.contentRefreshing || state.shelfLoading) return;
    state.shelfPage = Number(target.dataset.page);
    void refreshPublicContent();
    return;
  }
  if (action === 'more-picker-shelves' || action === 'retry-picker-shelves') {
    void loadPickerShelves(action === 'more-picker-shelves' ? state.shelfPickerPage + 1 : state.shelfPickerAttemptPage || 0);
    return;
  }
  if (action === 'signin-from-shelf-signup-prompt') {
    rememberInteraction({ kind: 'create-shelf' });
    closeShelfSignupPrompt();
    navigate('/login');
    return;
  }
  const accountRequiredActions = new Set([
    'open-shelf-picker', 'create-shelf', 'create-shelf-from-picker', 'edit-shelf',
    'delete-shelf', 'confirm-delete-shelf', 'cancel-delete-shelf', 'remove-post-from-shelf',
    'create-board', 'edit-own-board', 'toggle-artist-follow',
    'start-post', 'edit-post', 'resume-post-draft', 'save-post-draft',
    'discard-current-post-draft', 'discard-saved-post-draft', 'remove-post-media',
    'toggle-repost', 'confirm-repost', 'cancel-repost',
    'edit-profile', 'open-username-editor', 'cancel-username-editor',
    'remove-profile-image', 'cancel-profile-edit',
  ]);
  if (!activeAccount() && accountRequiredActions.has(action)) {
    const role = ['create-board', 'edit-own-board'].includes(action)
      ? 'Artist'
      : ['toggle-artist-follow', 'start-post', 'edit-post', 'resume-post-draft', 'toggle-repost', 'confirm-repost'].includes(action)
        ? 'Fan'
        : null;
    beginRegistration(role);
    return;
  }
  if (action === 'join') beginRegistration(target.dataset.role || null);
  else if (action === 'open-shelf-signup-prompt') openShelfSignupPrompt(target.dataset.shelfPromptFocus || 'create');
  else if (action === 'close-shelf-signup-prompt') closeShelfSignupPrompt();
  else if (action === 'join-from-shelf-signup-prompt') {
    rememberInteraction({ kind: 'create-shelf' });
    const role = target.dataset.role;
    if (role === 'Fan' || role === 'Artist') {
      state.shelfSignupPromptOpen = false;
      state.shelfSignupPromptFocusKey = '';
      beginRegistration(role);
    }
  }
  else if (action === 'choose-role') {
    state.draft.role = target.dataset.role;
    state.pendingRole = target.dataset.role;
    if (state.pendingRole === 'Fan' || state.pendingRole === 'Artist') {
      window.sessionStorage.setItem('stillroom.pendingRole', state.pendingRole);
    }
    state.errors.role = '';
    render();
  } else if (action === 'back-from-register') {
    state.errors = {};
    state.pendingRole = null;
    window.sessionStorage.removeItem('stillroom.pendingRole');
    state.draft = { role: null, name: '', username: '', email: '' };
    navigate(activeAccount() ? '/profile' : '/home');
  } else if (action === 'open-profile') navigate('/profile', { replace: true });
  else if (action === 'switch-account') {
    void endSession('/login');
  } else if (action === 'logout') {
    void endSession('/home');
  } else if (action === 'retry-data') {
    void syncSession();
  } else if (action === 'home-tab') {
    state.homeTab = target.dataset.tab;
    state.contentPage = 0;
    state.contentCursor = null;
    void refreshPublicContent();
    render();
  } else if (action === 'toggle-comments') {
    toggleComments(target.dataset.postId);
  } else if (action === 'edit-comment') {
    beginCommentEdit(target.dataset.commentId);
  } else if (action === 'cancel-comment-edit') {
    cancelCommentEdit();
  } else if (action === 'request-delete-comment') {
    requestDeleteComment(target.dataset.commentId);
  } else if (action === 'confirm-delete-comment') {
    confirmDeleteComment(target.dataset.commentId);
  } else if (action === 'cancel-delete-comment') {
    if (!state.commentPending) {
      state.commentDeleteConfirmId = null;
      render();
    }
  } else if (action === 'toggle-repost') {
    toggleRepost(target.dataset.postId);
  } else if (action === 'confirm-repost') {
    confirmRepost(target.dataset.postId);
  } else if (action === 'cancel-repost') {
    cancelRepost();
  } else if (action === 'open-search') {
    state.searchOpen = false;
    navigate('/explore');
    requestAnimationFrame(() => app.querySelector('[data-explore-search]')?.focus());
  } else if (action === 'edit-profile') {
    beginProfileEdit();
  } else if (action === 'open-username-editor') {
    beginUsernameEdit();
  } else if (action === 'cancel-username-editor') {
    cancelUsernameEdit();
  } else if (action === 'remove-profile-image') {
    if (state.editingProfile && !state.profileLoading && state.profileDraft) {
      state.profileDraft = { ...state.profileDraft, profileImage: '', profileImageAssetId: null };
      state.profileImageError = '';
      state.profileImageToken += 1;
      state.profileImageLoading = false;
      render();
    }
  } else if (action === 'cancel-profile-edit') {
    cancelProfileEdit();
  } else if (action === 'profile-activity-tab') {
    const profileId = target.dataset.profileId;
    const profile = state.accounts.find((entry) => entry.id === profileId && ['Fan', 'Artist'].includes(entry.role));
    if (profile && ['posts', 'reposts', 'shelves'].includes(target.dataset.tab)) {
      state.profileActivityTabs[profile.id] = target.dataset.tab;
      state.contentPage = 0;
      void refreshPublicContent();
      render();
    } else if (profileId === 'visitor' && ['posts', 'reposts', 'shelves'].includes(target.dataset.tab)) {
      state.profileActivityTabs.visitor = target.dataset.tab;
      render();
    }
  } else if (action === 'add-account') {
    state.editingProfile = false;
    void endSession('/register');
  } else if (action === 'create-shelf') {
    beginShelfForm('create');
  } else if (action === 'create-shelf-from-picker') {
    state.shelfReturnPostId = state.shelfPickerPostId;
    state.shelfReturnRoute = state.route;
    beginShelfForm('create');
  } else if (action === 'open-shelf-picker') {
    openShelfPicker(target.dataset.postId);
  } else if (action === 'close-shelf-picker') {
    if (!state.shelfLoading) {
      state.shelfPickerBusy = false;
      pickerReadSequence += 1;
      state.shelfPickerPostId = null;
      state.shelfPickerSelection = [];
      state.shelfPickerError = '';
      render();
    }
  } else if (action === 'edit-shelf') {
    beginShelfForm('edit', target.dataset.shelfId);
  } else if (action === 'cancel-shelf-form') {
    if (!state.shelfLoading) {
      state.shelfReturnPostId = null;
      state.shelfReturnRoute = null;
      state.shelfDraft = null;
      state.shelfErrors = {};
      navigate(target.dataset.cancelRoute || '/shelves');
    }
  } else if (action === 'delete-shelf') {
    const shelf = state.shelves.find((entry) => entry.id === target.dataset.shelfId && entry.ownerId === activeAccount()?.id);
    if (shelf && !state.shelfLoading) {
      state.shelfDeleteConfirmId = shelf.id;
      render();
    }
  } else if (action === 'confirm-delete-shelf') {
    confirmDeleteShelf(target.dataset.shelfId);
  } else if (action === 'cancel-delete-shelf') {
    if (!state.shelfLoading) {
      state.shelfDeleteConfirmId = null;
      render();
    }
  } else if (action === 'remove-post-from-shelf') {
    removePostFromShelf(target.dataset.shelfId, target.dataset.postId);
  } else if (action === 'create-board') {
    beginBoardForm('create');
  } else if (action === 'edit-own-board') {
    beginBoardForm('edit');
  } else if (action === 'toggle-artist-follow') {
    toggleArtistFollow(target.dataset.boardId);
  } else if (action === 'cancel-board-form') {
    if (!state.usernameLoading) {
      state.boardDraft = null;
      state.boardErrors = {};
      state.boardImageError = '';
      state.boardImageLoading = false;
      state.boardImageReadToken += 1;
      state.boardCoverToken += 1;
      state.boardCoverLoading = false;
      state.boardCoverError = '';
      navigate('/artists');
    }
  } else if (action === 'remove-board-cover') {
    state.boardCoverToken += 1;
    state.boardCoverLoading = false;
    state.boardCoverError = '';
    state.boardDraft = { ...(state.boardDraft || {}), coverImage: '', coverImageAssetId: null };
    render();
  } else if (action === 'remove-board-image') {
    state.boardDraft = { ...(state.boardDraft || {}), profileImage: '', profileImageAssetId: null };
    state.boardImageError = '';
    state.boardImageReadToken += 1;
    state.boardImageLoading = false;
    render();
  } else if (action === 'start-post' || action === 'edit-post' || action === 'resume-post-draft') {
    startPostComposer(target.dataset.boardId, target.dataset.postId || null);
  } else if (action === 'save-post-draft') {
    void saveCurrentPostDraft();
  } else if (action === 'discard-current-post-draft') {
    const editor = state.postEditor;
    const account = activeAccount();
    if (editor && account?.role === 'Fan' && editor.authorId === account.id) {
      void discardPostDraft(account.id, editor.boardId, editor.postId);
    }
  } else if (action === 'discard-saved-post-draft') {
    const account = activeAccount();
    const board = state.boards.find((entry) => entry.id === target.dataset.boardId);
    const postId = target.dataset.postId || null;
    const key = account?.role === 'Fan' && board ? postDraftKey(account.id, board.id, postId) : '';
    if (account?.role === 'Fan' && board && state.postDrafts[key]) {
      void discardPostDraft(account.id, board.id, postId);
    }
  } else if (action === 'remove-post-media') {
    const editor = state.postEditor;
    const draft = editor && state.postDrafts[editor.key];
    if (editor && draft && activeAccount()?.id === editor.authorId) {
      releaseDraftMedia(draft);
      state.postDrafts[editor.key] = { ...draft, media: null };
      state.postMediaToken += 1;
      state.postMediaLoading = false;
      state.postErrors[editor.key] = '';
      render();
    }
  } else if (action === 'request-delete-post') {
    const account = activeAccount();
    const post = state.posts.find((entry) => entry.id === target.dataset.postId);
    if (!state.postPublishing && state.commentPending?.postId !== post?.id && state.repostPending?.postId !== post?.id
      && account?.role === 'Fan' && post?.authorId === account.id) {
      state.deleteConfirmPostId = post.id;
      render();
    }
  } else if (action === 'cancel-delete-post') {
    state.deleteConfirmPostId = null;
    render();
  } else if (action === 'confirm-delete-post') {
    deletePost(target.dataset.postId);
  } else if (action === 'clear-explore-search') {
    state.exploreQuery = '';
    state.exploreError = '';
    const searchInput = app.querySelector('[data-explore-search]');
    if (searchInput) searchInput.value = '';
    const clearButton = app.querySelector('[data-action="clear-explore-search"]');
    if (clearButton) clearButton.hidden = true;
    queueExploreSearch();
  } else if (action === 'reset-explore') {
    resetExplore();
  } else if (action === 'retry-explore') {
    queueExploreSearch();
  }
});

window.addEventListener('keydown', (event) => {
  if (state.interactionPrompt) {
    if (event.key === 'Escape') { event.preventDefault(); closeInteractionPrompt(); return; }
    if (event.key === 'Tab') {
      const buttons = app.querySelector('.interaction-prompt')?.querySelectorAll('button:not(:disabled)');
      const first = buttons?.[0], last = buttons?.[buttons.length - 1];
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)
        || !app.querySelector('.interaction-prompt')?.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    }
    return;
  }
  if (!state.shelfSignupPromptOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeShelfSignupPrompt();
    return;
  }
  if (event.key !== 'Tab') return;
  const modal = app?.querySelector('.shelf-signup-modal');
  const buttons = modal?.querySelectorAll('button:not(:disabled)');
  const first = buttons?.[0];
  const last = buttons?.[buttons.length - 1];
  if (!modal || !first || !last) return;
  const focusIsOutside = !modal.contains(document.activeElement);
  if ((event.shiftKey && (document.activeElement === first || focusIsOutside))
    || (!event.shiftKey && (document.activeElement === last || focusIsOutside))) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
});

window.addEventListener('popstate', () => {
  state.contentCursor = null;
  state.shelfPage = 0;
  if (state.loading) cancelRegistration();
  if (state.boardLoading) cancelBoardOperation();
  if (state.shelfLoading) cancelShelfOperation();
  curation.onRouteChange(state.route, getRoute());
  settings.onRouteChange(state.route, getRoute());
  state.route = getRoute();
  state.contentPage = 0;
  if (state.route !== '/shelves') {
    state.shelfSignupPromptOpen = false;
    state.shelfSignupPromptFocusKey = '';
  }
  render();
  void refreshPublicContent();
});

// Other browsers/sessions pick up new public contributions without signing in again.
function refreshVisiblePublicContent() {
  if (document.hidden || state.contentPage || state.contentCursor || publicEditorActive()
    || state.authLoading || state.dataLoading || state.contentRefreshing
    || ['/login', '/register', '/profile/setup', '/confirmation'].includes(state.route)) return;
  void refreshPublicContent({ background: true });
}
window.addEventListener('focus', refreshVisiblePublicContent);
document.addEventListener('visibilitychange', refreshVisiblePublicContent);
window.setInterval(refreshVisiblePublicContent, 20000);

const initialSpecialRoute = /^\/(?:board\/[^/]+(?:\/collections\/[^/]+)?|post\/[^/]+|profile\/[^/]+|artists\/(?:new|edit)|shelves\/(?:new|[^/]+(?:\/edit)?))$/.test(state.route);
if (!navItems.some((item) => item.path === state.route) && !['/', '/register', '/login', '/profile/setup', '/confirmation', '/settings', '/recover', '/deletion-status'].includes(state.route) && !initialSpecialRoute) {
  state.route = '/';
  history.replaceState({}, '', hrefFor('/'));
}
void startStillroom();
