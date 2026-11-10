// Artist curation: Featured Posts and Collections on an Artist Board.
// Artists curate Fan Posts; they never publish, edit, or delete them.
import { apiRequest, contentQuery } from './api.js';

export const FEATURE_LIMIT = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getCuration(boardId, { collectionId, page = 0, collectionPage = 0 } = {}) {
  return apiRequest(`/social/boards/${encodeURIComponent(boardId)}/curation${contentQuery({ collectionId, page, collectionPage })}`);
}
export function runCuration(boardId, action, payload) {
  return apiRequest(`/social/boards/${encodeURIComponent(boardId)}/curation`, { method: 'POST', body: { action, payload } });
}

export function parseBoardRoute(route = '') {
  const match = route.match(/^\/board\/([^/]+)(?:\/collections\/([^/]+))?$/);
  if (!match) return null;
  const decode = (value) => { try { return decodeURIComponent(value); } catch { return value; } };
  return { boardId: decode(match[1]), collectionId: match[2] ? decode(match[2]) : null };
}

export function collectionRoute(boardId, collectionId) {
  return `/board/${encodeURIComponent(boardId)}/collections/${encodeURIComponent(collectionId)}`;
}

const mergeRows = (left = [], right = []) => [...new Map([...left, ...right].map((row) => [row.id, row])).values()];
// Primary (freshly bootstrapped) rows always win over cached curation rows.
const addMissing = (primary = [], cached = []) => {
  const ids = new Set(primary.map((row) => row.id));
  return [...primary, ...cached.filter((row) => !ids.has(row.id))];
};

// Merge only the dependencies curated cards need; never feed/page/private fields.
export function mergeCurationDependencies(target, snapshot) {
  if (!snapshot) return { posts: target.posts, accounts: target.accounts, boards: target.boards, comments: target.comments };
  return {
    posts: addMissing(target.posts, snapshot.posts),
    accounts: addMissing(target.accounts, snapshot.accounts),
    boards: addMissing(target.boards, snapshot.boards),
    comments: addMissing(target.comments, snapshot.comments),
  };
}

// Patch cached curation data with the result of a targeted mutation so stale
// snapshot rows can never overwrite fresh edits or resurrect deleted rows.
export function patchCurationData(data, action, payload = {}, result = {}) {
  if (!data?.snapshot) return data;
  const snapshot = { ...data.snapshot };
  let next = { ...data };
  const deletedPostId = action === 'post.delete' ? payload.postId : null;
  if (deletedPostId) {
    next.featuredPostIds = (data.featuredPostIds || []).filter((id) => id !== deletedPostId);
    next.collectionPostIds = (data.collectionPostIds || []).filter((id) => id !== deletedPostId);
    snapshot.posts = (snapshot.posts || []).filter((post) => post.id !== deletedPostId);
    snapshot.comments = (snapshot.comments || []).filter((comment) => comment.postId !== deletedPostId);
  }
  const cachedPostIds = new Set((snapshot.posts || []).map((post) => post.id));
  const freshPosts = (result.posts || []).filter((post) => cachedPostIds.has(post.id));
  snapshot.posts = mergeRows(snapshot.posts, freshPosts);
  const deletedCommentId = result.deletedCommentId || (action === 'comment.delete' ? payload.commentId : null);
  let comments = snapshot.comments || [];
  const freshComments = [...(result.comments || []), ...(result.commentResult ? [result.commentResult] : [])]
    .filter((comment) => cachedPostIds.has(comment.postId));
  comments = mergeRows(comments, freshComments);
  if (deletedCommentId) comments = comments.filter((comment) => comment.id !== deletedCommentId);
  snapshot.comments = comments;
  next.snapshot = snapshot;
  return next;
}

// Strip DOM ids so the same post can appear in Featured and All Fan Posts.
export function withoutCardIds(html) {
  return html.replace(/\sid="post-card-[^"]*"/g, '');
}

const emptyData = () => ({ boardId: null, featuredPostIds: [], collections: [], collectionPagination: { page: 0, pageSize: 20, hasMore: false }, selectedCollection: null, collectionPostIds: [], postPagination: { page: 0, pageSize: 20, hasMore: false }, snapshot: null });

export function createCuration(ctx) {
  const { state, escapeHTML, icon, hrefFor, renderEmpty } = ctx;
  const api = { getCuration, runCuration, ...(ctx.api || {}) };
  const cur = {
    key: '', data: emptyData(), loading: false, error: '', token: 0,
    collectionPage: 0, postPage: 0, preview: false, pagePostIds: null,
    pending: null, status: null, form: null, formError: '', deleteConfirmId: null,
    picker: null, mutationToken: 0,
  };

  const own = (board) => {
    const account = ctx.activeAccount();
    return Boolean(board && account?.role === 'Artist' && account.id === board.ownerId);
  };
  const manage = (board) => own(board) && !cur.preview;
  const routeInfo = () => parseBoardRoute(state.route);
  const desiredKey = () => {
    const info = routeInfo();
    if (!info) return '';
    return JSON.stringify([ctx.getAuthGeneration(), state.activeAccountId, info.boardId, info.collectionId, cur.postPage, cur.collectionPage]);
  };
  const guard = (token, key) => token === cur.token && key === desiredKey();

  function reset() {
    cur.token += 1;
    cur.key = ''; cur.data = emptyData(); cur.loading = false; cur.error = '';
    cur.collectionPage = 0; cur.postPage = 0; cur.preview = false; cur.pagePostIds = null;
    cur.pending = null; cur.status = null; cur.form = null; cur.formError = ''; cur.deleteConfirmId = null;
    cur.mutationToken += 1;
    closePicker();
  }

  // Called by main.persistAction before the response is applied.
  function afterMutation(action, payload, result) {
    if (!/^(post|comment)\./.test(action)) return;
    cur.data = patchCurationData(cur.data, action, payload, result || {});
    if (action === 'post.delete') {
      state.posts = state.posts.filter((post) => post.id !== payload.postId);
      if (cur.pagePostIds) cur.pagePostIds.delete(payload.postId);
    }
    if (routeInfo()) void load({ force: true, background: true });
  }

  function applyDependencies({ fresh = false } = {}) {
    if (fresh && cur.pagePostIds && cur.data.snapshot) {
      const visibleIds = new Set([...cur.pagePostIds, ...(cur.data.snapshot.posts || []).map((post) => post.id)]);
      // Collection pages replace their dependency window, rather than retaining
      // every previously visited page of original posts and comment previews.
      state.posts = state.posts.filter((post) => visibleIds.has(post.id));
      state.comments = state.comments.filter((comment) => visibleIds.has(comment.postId));
      if (Array.isArray(state.reposts)) state.reposts = state.reposts.filter((row) => visibleIds.has(row.postId));
    }
    const merged = mergeCurationDependencies(state, cur.data.snapshot);
    state.posts = merged.posts; state.accounts = merged.accounts; state.boards = merged.boards; state.comments = merged.comments;
    if (!fresh || !cur.data.snapshot) return;
    const snapshot = cur.data.snapshot;
    // A completed, session/route-guarded read is newer than our dependency
    // cache. Cached fallback merges above must not freeze remote edits forever.
    state.posts = mergeRows(state.posts, snapshot.posts);
    state.accounts = mergeRows(state.accounts, snapshot.accounts);
    state.boards = mergeRows(state.boards, snapshot.boards);
    const ids = new Set((snapshot.posts || []).map((post) => post.id));
    const olderWindows = state.commentWindows || {};
    state.comments = mergeRows(
      state.comments.filter((comment) => !ids.has(comment.postId) || olderWindows[comment.postId]),
      snapshot.comments,
    );
    for (const [postId, pagination] of Object.entries(snapshot.commentPagination || {})) {
      if (!olderWindows[postId]) state.commentPagination = { ...state.commentPagination, [postId]: pagination };
    }
    // Curated originals may be outside the Board's current post page. Preserve
    // the actor's real Undo Repost state without replacing Feed event IDs,
    // private Shelves, drafts, or any other list/pagination state.
    if (Array.isArray(state.reposts)) {
      state.reposts = mergeRows(state.reposts.filter((row) => !ids.has(row.postId)), snapshot.reposts);
    }
  }

  // Called by main.applyBootstrap. pagePosts is null for interaction patches.
  function afterBootstrap(pagePosts) {
    if (pagePosts) cur.pagePostIds = new Set(pagePosts.map((post) => post.id));
    if (cur.data.boardId && routeInfo()?.boardId === cur.data.boardId) applyDependencies();
  }

  async function load({ force = false, background = false } = {}) {
    const info = routeInfo();
    if (!info || state.authLoading) return;
    if (info.collectionId && !UUID.test(info.collectionId)) {
      cur.key = desiredKey(); cur.error = 'This collection link is not valid.'; return;
    }
    const key = desiredKey();
    if (!force && (cur.key === key || cur.loading)) return;
    const token = ++cur.token;
    cur.key = key; cur.loading = true;
    if (!background) cur.error = '';
    try {
      const data = await api.getCuration(info.boardId, { collectionId: info.collectionId || undefined, page: cur.postPage, collectionPage: cur.collectionPage });
      if (!guard(token, key)) return;
      cur.data = { ...emptyData(), ...data };
      cur.error = '';
      applyDependencies({ fresh: true });
    } catch (error) {
      if (!guard(token, key)) return;
      cur.error = error.message || 'Featured posts and collections could not load.';
    } finally {
      if (token === cur.token) {
        cur.loading = false;
        if (!background || !editorActive()) ctx.render();
      }
    }
  }

  function ensure() {
    const key = desiredKey();
    if (!key) { if (cur.key) reset(); return; }
    const info = routeInfo();
    if (cur.data.boardId && cur.data.boardId !== info.boardId) {
      const keepPreview = false;
      cur.data = emptyData(); cur.pagePostIds = null; cur.form = null; cur.preview = keepPreview; cur.collectionPage = 0; cur.postPage = 0;
      closePicker();
    }
    if (cur.key !== desiredKey() && !cur.loading) Promise.resolve().then(() => load());
  }

  function editorActive() {
    return Boolean(cur.form || cur.pending || cur.picker || cur.deleteConfirmId);
  }

  async function mutate(action, payload, message, after) {
    const info = routeInfo();
    if (!info || cur.pending) return;
    const token = ++cur.mutationToken;
    const generation = ctx.getAuthGeneration();
    const accountId = state.activeAccountId;
    const originRoute = state.route;
    const current = () => token === cur.mutationToken && generation === ctx.getAuthGeneration()
      && accountId === state.activeAccountId && originRoute === state.route;
    cur.pending = { action, id: payload.postId || payload.collectionId || 'new' };
    cur.status = null;
    ctx.render();
    try {
      await api.runCuration(info.boardId, action, payload);
      if (!current()) return;
      cur.status = { kind: 'success', message };
      cur.pending = null;
      after?.();
      if (current()) await load({ force: true });
    } catch (error) {
      if (!current()) return;
      cur.status = { kind: 'error', message: error.message || 'That change could not be saved.' };
      if (action === 'collection.save') cur.formError = cur.status.message;
    } finally {
      if (token === cur.mutationToken && cur.pending) { cur.pending = null; ctx.render(); }
      else if (current()) ctx.render();
    }
  }

  // Collection picker pages through every collection independently of the board view.
  let pickerOpener = null;
  let pickerNeedsFocus = false;
  function closePickerAndRestore() {
    const postId = cur.picker?.postId || pickerOpener;
    closePicker();
    ctx.render();
    const opener = [...(app()?.querySelectorAll?.('[data-action="collection-picker-open"]') || [])].find((node) => node.dataset.postId === postId);
    opener?.focus?.();
  }
  // Focus management for the picker dialog; main.js calls this after each render.
  function afterRender() {
    if (!cur.picker || !pickerNeedsFocus) return;
    const dialog = app()?.querySelector?.('.collection-picker-dialog');
    if (dialog) { pickerNeedsFocus = false; dialog.querySelector('[data-action="collection-picker-close"]')?.focus(); }
  }
  function handleKeydown(event) {
    if (!cur.picker) return false;
    if (event.key === 'Escape') { event.preventDefault(); closePickerAndRestore(); return true; }
    if (event.key !== 'Tab') return false;
    const dialog = app()?.querySelector?.('.collection-picker-dialog');
    const focusable = [...(dialog?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)') || [])];
    if (!focusable.length) return false;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    const outside = !dialog.contains(document.activeElement);
    if (outside || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
    return true;
  }
  function handleBackdrop(element) {
    if (cur.picker && element?.classList?.contains('collection-picker-backdrop')) { closePickerAndRestore(); return true; }
    return false;
  }
  function closePicker() {
    if (cur.picker) cur.picker.token += 1;
    cur.picker = null;
  }
  async function loadPicker(page) {
    const picker = cur.picker;
    const info = routeInfo();
    if (!picker || !info || picker.busy) return;
    picker.status = null;
    const token = ++picker.token;
    picker.loading = true; picker.error = ''; picker.page = page;
    ctx.render();
    const generation = ctx.getAuthGeneration();
    try {
      const data = await api.getCuration(info.boardId, { collectionPage: page });
      if (cur.picker !== picker || token !== picker.token || generation !== ctx.getAuthGeneration()) return;
      picker.collections = data.collections || [];
      picker.hasMore = Boolean(data.collectionPagination?.hasMore);
    } catch (error) {
      if (cur.picker !== picker || token !== picker.token) return;
      picker.error = error.message || 'Collections could not load.';
    } finally {
      if (cur.picker === picker && token === picker.token) { picker.loading = false; ctx.render(); }
    }
  }
  async function pickerSet(collectionId, active) {
    const picker = cur.picker;
    const info = routeInfo();
    if (!picker || !info || picker.busy) return;
    const generation = ctx.getAuthGeneration();
    picker.busy = collectionId; picker.status = null;
    ctx.render();
    try {
      await api.runCuration(info.boardId, 'collection.post', { collectionId, postId: picker.postId, active });
      if (cur.picker !== picker || generation !== ctx.getAuthGeneration() || routeInfo()?.boardId !== info.boardId) return;
      const title = picker.collections.find((entry) => entry.id === collectionId)?.title || 'collection';
      picker.status = { kind: 'success', message: active ? `Added to ${title}.` : `Removed from ${title}.` };
      void load({ force: true, background: true });
    } catch (error) {
      if (cur.picker !== picker) return;
      picker.status = { kind: 'error', message: error.message || 'That change could not be saved.' };
    } finally {
      if (cur.picker === picker) { picker.busy = null; ctx.render(); }
    }
  }

  function submitCollectionForm(form) {
    const data = new FormData(form);
    const title = String(data.get('collectionTitle') || '').trim();
    const description = String(data.get('collectionDescription') || '').trim();
    cur.form = { ...cur.form, title, description };
    if (!title) { cur.formError = 'Give this collection a title.'; ctx.render(); app().querySelector('[name="collectionTitle"]')?.focus(); return; }
    if (title.length > 100) { cur.formError = 'Keep the title to 100 characters or fewer.'; ctx.render(); return; }
    if (description.length > 1000) { cur.formError = 'Keep the description to 1000 characters or fewer.'; ctx.render(); return; }
    cur.formError = '';
    const editing = Boolean(cur.form.id);
    void mutate('collection.save', { collectionId: cur.form.id || null, title, description }, editing ? 'Collection updated.' : 'Collection created.', () => { cur.form = null; });
  }
  const app = () => document.querySelector('#app');

  function handleClick(action, target) {
    const d = target.dataset;
    switch (action) {
      case 'curation-preview': cur.preview = !cur.preview; closePicker(); cur.form = null; cur.deleteConfirmId = null; ctx.render(); return true;
      case 'curation-retry': void load({ force: true }); return true;
      case 'feature-set': void mutate('feature.set', { postId: d.postId, active: d.active === 'true' }, d.active === 'true' ? 'Post featured on your board.' : 'Post removed from Featured.'); return true;
      case 'feature-move': void mutate('feature.move', { postId: d.postId, direction: d.direction }, 'Featured order updated.'); return true;
      case 'collection-new': cur.form = { id: null, title: '', description: '' }; cur.formError = ''; ctx.render(); app().querySelector('[name="collectionTitle"]')?.focus(); return true;
      case 'collection-edit': {
        const collection = [...cur.data.collections, cur.data.selectedCollection].find((entry) => entry?.id === d.collectionId);
        if (collection) { cur.form = { id: collection.id, title: collection.title, description: collection.description || '' }; cur.formError = ''; ctx.render(); app().querySelector('[name="collectionTitle"]')?.focus(); }
        return true;
      }
      case 'collection-cancel': cur.form = null; cur.formError = ''; ctx.render(); return true;
      case 'collection-delete': cur.deleteConfirmId = d.collectionId; ctx.render(); return true;
      case 'collection-delete-cancel': cur.deleteConfirmId = null; ctx.render(); return true;
      case 'collection-delete-confirm': {
        const info = routeInfo();
        const leaving = info?.collectionId === d.collectionId;
        void mutate('collection.delete', { collectionId: d.collectionId }, 'Collection deleted. The original Fan Posts are untouched.', () => {
          cur.deleteConfirmId = null;
          if (leaving) ctx.navigate(`/board/${encodeURIComponent(info.boardId)}`);
        });
        return true;
      }
      case 'collection-move': void mutate('collection.move', { collectionId: d.collectionId, direction: d.direction }, 'Collection order updated.'); return true;
      case 'collection-remove-post': void mutate('collection.post', { collectionId: d.collectionId, postId: d.postId, active: false }, 'Removed from this collection. The original post is untouched.'); return true;
      case 'collection-page': cur.collectionPage = Math.max(0, Number(d.page) || 0); void load(); ctx.render(); return true;
      case 'collection-post-page': cur.postPage = Math.max(0, Number(d.page) || 0); void load(); ctx.render(); return true;
      case 'collection-picker-open': pickerOpener = d.postId; pickerNeedsFocus = true; cur.picker = { postId: d.postId, page: 0, collections: [], hasMore: false, loading: true, error: '', status: null, busy: null, token: 0 }; void loadPicker(0); return true;
      case 'collection-picker-close': closePickerAndRestore(); return true;
      case 'collection-picker-page': void loadPicker(Math.max(0, Number(d.page) || 0)); return true;
      case 'collection-picker-set': void pickerSet(d.collectionId, d.active === 'true'); return true;
      case 'curation-jump': {
        const node = document.getElementById(`post-card-${d.postId}`);
        node?.scrollIntoView?.({ block: 'start' });
        node?.querySelector?.('a, button')?.focus?.({ preventScroll: true });
        return true;
      }
      case 'curation-dismiss': cur.status = null; ctx.render(); return true;
      default: return false;
    }
  }

  // Leaving a board (or switching collection) resets per-view pagination.
  function onRouteChange(previous, next) {
    const a = parseBoardRoute(previous); const b = parseBoardRoute(next);
    if (!b || a?.boardId !== b.boardId) { const preview = false; cur.preview = preview; cur.form = null; cur.deleteConfirmId = null; cur.status = null; cur.collectionPage = 0; }
    if (a?.collectionId !== b?.collectionId) {
      cur.postPage = 0;
      cur.data = { ...cur.data, selectedCollection: null, collectionPostIds: [], postPagination: { page: 0, pageSize: 20, hasMore: false } };
    }
    if (previous !== next) {
      cur.mutationToken += 1;
      cur.pending = null;
      cur.form = null; cur.formError = ''; cur.deleteConfirmId = null;
      cur.token += 1; cur.loading = false; cur.key = '';
    }
    closePicker();
  }

  /* ---------- Rendering ---------- */
  const busy = () => (cur.pending ? 'disabled' : '');
  const isPending = (action, id) => cur.pending?.action === action && cur.pending.id === id;

  function renderStatus() {
    if (!cur.status) return '';
    const error = cur.status.kind === 'error';
    return `<p class="${error ? 'error-banner' : 'success-banner'} curation-status" role="${error ? 'alert' : 'status'}" data-testid="status-curation">${error ? '' : icon('check', 14)}<span>${escapeHTML(cur.status.message)}</span><button class="text-button" type="button" data-action="curation-dismiss" aria-label="Dismiss message">${icon('close', 12)}</button></p>`;
  }

  function renderCover(collection, large = false) {
    const cover = collection.cover;
    const inner = cover?.url
      ? cover.type === 'video'
        ? `<video src="${escapeHTML(cover.url)}" muted playsinline preload="metadata" aria-hidden="true" tabindex="-1"></video>`
        : `<img src="${escapeHTML(cover.url)}" alt="" loading="lazy">`
      : `<span class="collection-cover-empty" aria-hidden="true">${escapeHTML((collection.title.trim()[0] || 'C').toUpperCase())}</span>`;
    return `<span class="collection-cover ${large ? 'collection-cover-large' : ''}">${inner}</span>`;
  }

  function ownerToolbar(board, post, { featuredIndex = -1, featuredCount = 0 } = {}) {
    if (!manage(board)) return '';
    const featured = cur.data.featuredPostIds.includes(post.id);
    const full = cur.data.featuredPostIds.length >= FEATURE_LIMIT;
    const id = escapeHTML(post.id);
    const featureButton = featured
      ? `<button class="text-button" type="button" data-action="feature-set" data-post-id="${id}" data-active="false" ${busy()} data-testid="button-unfeature-${id}">${isPending('feature.set', post.id) ? 'Saving…' : 'Remove from Featured'}</button>`
      : `<button class="text-button curation-accent" type="button" data-action="feature-set" data-post-id="${id}" data-active="true" ${busy() || (full ? 'disabled' : '')} ${full ? `title="Featured holds ${FEATURE_LIMIT} posts. Remove one first."` : ''} data-testid="button-feature-${id}">${icon('sparkle', 13)} ${isPending('feature.set', post.id) ? 'Saving…' : full ? 'Featured is full' : 'Feature Post'}</button>`;
    const moves = featuredIndex >= 0
      ? `<span class="curation-move" role="group" aria-label="Reorder featured post"><button class="icon-button" type="button" data-action="feature-move" data-post-id="${id}" data-direction="up" aria-label="Move up" ${featuredIndex === 0 ? 'disabled' : busy()}>${arrow('up')}</button><button class="icon-button" type="button" data-action="feature-move" data-post-id="${id}" data-direction="down" aria-label="Move down" ${featuredIndex === featuredCount - 1 ? 'disabled' : busy()}>${arrow('down')}</button></span>`
      : '';
    return `<div class="curation-toolbar" aria-label="Curate this Fan Post">${moves}${featureButton}<button class="text-button" type="button" data-action="collection-picker-open" data-post-id="${id}" ${busy()}>${icon('plus', 13)} Collections</button></div>`;
  }

  function arrow(direction) {
    return `<svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${direction === 'up' ? '<path d="m6 14 6-6 6 6"/>' : '<path d="m6 10 6 6 6-6"/>'}</svg>`;
  }

  function card(post) { return ctx.renderPostCard(post); }
  // A post already rendered in Featured appears once more in All Fan Posts as
  // a compact reference, so forms, ids and comment threads never duplicate.
  function featuredOnPage(board) {
    return cur.data.boardId === board.id ? new Set(cur.data.featuredPostIds.filter((id) => state.posts.some((post) => post.id === id))) : new Set();
  }
  function renderReference(post) {
    const id = escapeHTML(post.id);
    const profileRoute = `/profile/${encodeURIComponent(post.authorId)}`;
    return `<article class="post-reference" aria-label="Fan Post by @${escapeHTML(post.authorUsername)}, shown in Featured"><span class="post-reference-meta"><a href="${hrefFor(profileRoute)}" data-route="${profileRoute}">@${escapeHTML(post.authorUsername)}</a> · Featured above</span>${post.content ? `<p class="post-reference-copy">${escapeHTML(post.content.slice(0, 180))}${post.content.length > 180 ? '…' : ''}</p>` : ''}<a class="text-link" href="#post-card-${id}" data-action="curation-jump" data-post-id="${id}">View in Featured ${icon('arrow', 12)}</a></article>`;
  }

  function renderLoadState(label) {
    if (cur.error) return `<p class="inline-error curation-error" role="alert">${escapeHTML(cur.error)} <button class="text-button" type="button" data-action="curation-retry">Try again</button></p>`;
    if (cur.loading && !cur.data.boardId) return `<div class="curation-skeleton" aria-busy="true" aria-label="Loading ${label}"><span></span><span></span><span></span></div>`;
    return '';
  }

  function renderPreviewBar(board) {
    if (!own(board)) return '';
    return `<div class="curation-preview-bar ${cur.preview ? 'is-preview' : ''}" role="region" aria-label="Board view mode">
      <span>${cur.preview ? 'You are viewing your board as visitors see it.' : 'You are managing your board.'}</span>
      <button class="quiet-button" type="button" data-action="curation-preview" aria-pressed="${cur.preview}" data-testid="button-toggle-preview">${cur.preview ? 'Exit public preview' : 'Preview as visitor'}</button>
    </div>`;
  }

  function renderFeatured(board) {
    const ids = cur.data.boardId === board.id ? cur.data.featuredPostIds : [];
    const posts = ids.map((id) => state.posts.find((post) => post.id === id)).filter(Boolean);
    const managing = manage(board);
    const loadState = renderLoadState('featured posts');
    if (!posts.length && !managing) return loadState ? `<section class="curation-section" aria-label="Featured and collections">${loadState}</section>` : '';
    return `<section class="curation-section featured-section" aria-labelledby="featured-heading">
      <div class="curation-heading"><div><p class="eyebrow">Chosen by the Artist</p><h2 class="section-heading" id="featured-heading">Featured</h2></div>${managing ? `<span class="curation-count">${posts.length} of ${FEATURE_LIMIT}</span>` : ''}</div>
      ${loadState}
      ${posts.length ? `<ol class="featured-list">${posts.map((post, index) => `<li class="featured-item"><span class="featured-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div class="featured-body">${ownerToolbar(board, post, { featuredIndex: index, featuredCount: posts.length })}${card(post)}</div></li>`).join('')}</ol>`
        : `<div class="curation-empty"><p class="empty-title">Nothing featured yet.</p><p class="empty-copy">Choose up to ${FEATURE_LIMIT} Fan Posts below with Feature Post. Fans keep full credit for their work.</p></div>`}
    </section>`;
  }

  function renderCollectionForm() {
    if (!cur.form) return '';
    const pending = cur.pending?.action === 'collection.save';
    return `<form class="collection-form" data-form="collection" novalidate ${pending ? 'aria-busy="true"' : ''}>
      <p class="eyebrow">${cur.form.id ? 'Edit collection' : 'New collection'}</p>
      ${cur.formError ? `<p class="inline-error" role="alert" id="collection-form-error">${escapeHTML(cur.formError)}</p>` : ''}
      <label class="field-label">Title<input class="field-input" name="collectionTitle" maxlength="100" value="${escapeHTML(cur.form.title)}" placeholder="Name this collection" required ${cur.formError ? 'aria-describedby="collection-form-error"' : ''} ${pending ? 'disabled' : ''} data-testid="input-collection-title"></label>
      <label class="field-label">Description <span class="optional-label">(optional)</span><textarea class="field-input field-textarea" name="collectionDescription" maxlength="1000" rows="3" placeholder="What ties these Fan Posts together?" ${pending ? 'disabled' : ''}>${escapeHTML(cur.form.description)}</textarea></label>
      <div class="board-form-footer"><button class="primary-button" type="submit" ${pending ? 'disabled' : ''} data-testid="button-save-collection">${pending ? '<span class="registration-loading"><span class="loading-dot"></span>Saving…</span>' : `${cur.form.id ? 'Save collection' : 'Create collection'} ${icon('arrow', 13)}`}</button><button class="quiet-button" type="button" data-action="collection-cancel" ${pending ? 'disabled' : ''}>Cancel</button></div>
    </form>`;
  }

  function renderDeleteConfirm(collection) {
    if (cur.deleteConfirmId !== collection.id) return '';
    return `<div class="collection-delete-confirm" role="alert"><span>Delete “${escapeHTML(collection.title)}”? Fan Posts stay on the board.</span><button class="text-button text-danger" type="button" data-action="collection-delete-confirm" data-collection-id="${escapeHTML(collection.id)}" ${busy()}>${isPending('collection.delete', collection.id) ? 'Deleting…' : 'Delete'}</button><button class="text-button" type="button" data-action="collection-delete-cancel" ${busy()}>Cancel</button></div>`;
  }

  function renderCollections(board) {
    const data = cur.data.boardId === board.id ? cur.data : emptyData();
    const managing = manage(board);
    if (cur.error && !data.collections.length && !managing) return '';
    const list = data.collections;
    const page = data.collectionPagination?.page || 0;
    const hasMore = data.collectionPagination?.hasMore;
    if (!list.length && !page && !managing) return '';
    const cards = list.map((collection, index) => {
      const route = collectionRoute(board.id, collection.id);
      const id = escapeHTML(collection.id);
      const first = page === 0 && index === 0;
      const last = !hasMore && index === list.length - 1;
      return `<li class="collection-card-wrap">
        <a class="collection-card" href="${hrefFor(route)}" data-route="${route}" data-testid="link-collection-${id}">${renderCover(collection)}<span class="collection-card-copy"><span class="collection-card-title">${escapeHTML(collection.title)}</span><span class="collection-card-meta">${collection.postCount} ${collection.postCount === 1 ? 'Fan Post' : 'Fan Posts'}</span></span></a>
        ${managing ? `<div class="collection-card-tools"><span class="curation-move" role="group" aria-label="Reorder ${escapeHTML(collection.title)}"><button class="icon-button" type="button" data-action="collection-move" data-collection-id="${id}" data-direction="up" aria-label="Move ${escapeHTML(collection.title)} earlier" ${first ? 'disabled' : busy()}>${arrow('up')}</button><button class="icon-button" type="button" data-action="collection-move" data-collection-id="${id}" data-direction="down" aria-label="Move ${escapeHTML(collection.title)} later" ${last ? 'disabled' : busy()}>${arrow('down')}</button></span><button class="text-button" type="button" data-action="collection-edit" data-collection-id="${id}" ${busy()}>${icon('edit', 12)} Edit</button><button class="text-button text-danger" type="button" data-action="collection-delete" data-collection-id="${id}" ${busy()}>${icon('trash', 12)} Delete</button></div>${renderDeleteConfirm(collection)}` : ''}
      </li>`;
    }).join('');
    return `<section class="curation-section collections-section" aria-labelledby="collections-heading">
      <div class="curation-heading"><div><p class="eyebrow">Arranged from Fan work</p><h2 class="section-heading" id="collections-heading">Collections</h2></div>${managing && !cur.form ? `<button class="quiet-button" type="button" data-action="collection-new" ${busy()} data-testid="button-new-collection">${icon('plus', 13)} New collection</button>` : ''}</div>
      ${managing ? renderCollectionForm() : ''}
      ${list.length ? `<ul class="collection-grid">${cards}</ul>` : managing && !cur.form ? `<div class="curation-empty"><p class="empty-title">No collections yet.</p><p class="empty-copy">Group Fan Posts by theme. A post can sit in as many collections as you like.</p></div>` : ''}
      ${page || hasMore ? `<nav class="content-pagination" aria-label="Collection pages"><button class="quiet-button" type="button" data-action="collection-page" data-page="${Math.max(0, page - 1)}" ${!page || cur.loading ? 'disabled' : ''}>Previous</button><span role="status">${cur.loading ? 'Loading…' : `Page ${page + 1}`}</span><button class="quiet-button" type="button" data-action="collection-page" data-page="${page + 1}" ${!hasMore || cur.loading ? 'disabled' : ''}>Next</button></nav>` : ''}
    </section>`;
  }

  // Board order after profile/cover: Featured, Collections. All Fan Posts follow in main.js.
  function renderBoardSections(board) {
    return `${renderPreviewBar(board)}${renderStatus()}${renderFeatured(board)}${renderCollections(board)}`;
  }

  // Board-page posts only; curated dependency posts never leak into this list.
  function boardPagePosts(board) {
    return state.posts.filter((post) => post.boardId === board.id && (!cur.pagePostIds || cur.pagePostIds.has(post.id)));
  }
  function renderBoardPost(board, post) {
    const body = featuredOnPage(board).has(post.id) ? renderReference(post) : ctx.renderPostCard(post);
    return manage(board) ? `<div class="curated-post-wrap">${ownerToolbar(board, post)}${body}</div>` : body;
  }

  function renderCollectionDetail(board, collectionId) {
    const boardPath = `/board/${encodeURIComponent(board.id)}`;
    const back = `<a class="shelf-back-link" href="${hrefFor(boardPath)}" data-route="${boardPath}">${icon('back', 13)} ${escapeHTML(board.artistName)}’s board</a>`;
    const ready = cur.data.boardId === board.id && cur.key === desiredKey() && !cur.loading;
    const collection = cur.data.boardId === board.id && cur.data.selectedCollection?.id === collectionId ? cur.data.selectedCollection : null;
    if (cur.error) return `<section>${back}${renderLoadState('collection')}</section>`;
    if (!collection) {
      if (!ready) return `<section>${back}<div class="curation-skeleton curation-skeleton-tall" aria-busy="true" aria-label="Loading collection"><span></span><span></span><span></span></div></section>`;
      return `<section>${back}<h1 class="page-title">Collection not found.</h1><p class="page-subtitle">It may have been removed by the Artist.</p>${renderEmpty('No collection here.')}</section>`;
    }
    const managing = manage(board);
    const posts = cur.data.collectionPostIds.map((id) => state.posts.find((post) => post.id === id)).filter(Boolean);
    const page = cur.data.postPagination?.page || 0;
    const hasMore = cur.data.postPagination?.hasMore;
    const id = escapeHTML(collection.id);
    return `<section class="collection-detail">${back}
      ${renderPreviewBar(board)}${renderStatus()}
      <header class="collection-hero">${renderCover(collection, true)}<div class="collection-hero-copy"><p class="eyebrow">Collection · ${collection.postCount} ${collection.postCount === 1 ? 'Fan Post' : 'Fan Posts'}</p><h1 class="page-title">${escapeHTML(collection.title)}</h1>${collection.description ? `<p class="board-biography">${escapeHTML(collection.description)}</p>` : ''}
        ${managing ? `<div class="collection-card-tools"><button class="quiet-button" type="button" data-action="collection-edit" data-collection-id="${id}" ${busy()}>${icon('edit', 13)} Edit</button><button class="quiet-button text-danger" type="button" data-action="collection-delete" data-collection-id="${id}" ${busy()}>${icon('trash', 13)} Delete</button></div>${renderDeleteConfirm(collection)}` : ''}
      </div></header>
      ${managing ? renderCollectionForm() : ''}
      ${posts.length ? `<div class="post-list">${posts.map((post) => `<div class="curated-post-wrap">${managing ? `<div class="curation-toolbar"><button class="text-button text-danger" type="button" data-action="collection-remove-post" data-collection-id="${id}" data-post-id="${escapeHTML(post.id)}" ${busy()}>${isPending('collection.post', collection.id) ? 'Removing…' : 'Remove from collection'}</button></div>` : ''}${card(post)}</div>`).join('')}</div>`
        : renderEmpty('This collection is empty.', managing ? 'Add Fan Posts from your board with the Collections button.' : 'The Artist hasn’t added posts here yet.')}
      ${page || hasMore ? `<nav class="content-pagination" aria-label="Collection post pages"><button class="quiet-button" type="button" data-action="collection-post-page" data-page="${Math.max(0, page - 1)}" ${!page || cur.loading ? 'disabled' : ''}>Previous</button><span role="status">${cur.loading ? 'Loading…' : `Page ${page + 1}`}</span><button class="quiet-button" type="button" data-action="collection-post-page" data-page="${page + 1}" ${!hasMore || cur.loading ? 'disabled' : ''}>Next</button></nav>` : ''}
    </section>`;
  }

  function renderPicker() {
    const picker = cur.picker;
    if (!picker) return '';
    const post = state.posts.find((entry) => entry.id === picker.postId);
    const rows = picker.collections.map((collection) => {
      const cid = escapeHTML(collection.id);
      const working = picker.busy === collection.id;
      return `<li class="collection-picker-row">${renderCover(collection)}<span class="collection-card-copy"><span class="collection-card-title">${escapeHTML(collection.title)}</span><span class="collection-card-meta">${collection.postCount} ${collection.postCount === 1 ? 'post' : 'posts'}</span></span><span class="collection-picker-actions"><button class="quiet-button" type="button" data-action="collection-picker-set" data-collection-id="${cid}" data-active="true" ${picker.busy ? 'disabled' : ''}>${working ? 'Saving…' : 'Add'}</button><button class="text-button text-danger" type="button" data-action="collection-picker-set" data-collection-id="${cid}" data-active="false" ${picker.busy ? 'disabled' : ''}>Remove</button></span></li>`;
    }).join('');
    return `<div class="shelf-modal-backdrop collection-picker-backdrop"><div class="shelf-picker collection-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-picker-title" aria-busy="${picker.loading || Boolean(picker.busy)}">
      <div class="shelf-picker-head"><div><p class="eyebrow">Organize</p><h2 class="shelf-picker-heading" id="collection-picker-title">Add to collections</h2></div><button class="icon-button" type="button" data-action="collection-picker-close" data-post-id="${escapeHTML(picker.postId)}" aria-label="Close">${icon('close')}</button></div>
      ${post ? `<p class="shelf-picker-post">@${escapeHTML(post.authorUsername)} — ${escapeHTML(post.content || 'Media post')}</p>` : ''}
      <p class="field-hint">Adding is safe to repeat. The Fan Post itself is never copied or changed.</p>
      ${picker.status ? `<p class="${picker.status.kind === 'error' ? 'inline-error' : 'shelf-post-status'}" role="${picker.status.kind === 'error' ? 'alert' : 'status'}">${picker.status.kind === 'error' ? '' : icon('check', 13)}${escapeHTML(picker.status.message)}</p>` : ''}
      ${picker.error ? `<p class="inline-error" role="alert">${escapeHTML(picker.error)} <button class="text-button" type="button" data-action="collection-picker-page" data-page="${picker.page}">Try again</button></p>` : ''}
      ${picker.loading ? '<div class="curation-skeleton" aria-busy="true" aria-label="Loading collections"><span></span><span></span></div>'
        : rows ? `<ul class="collection-picker-list">${rows}</ul>` : picker.error ? '' : `<div class="curation-empty"><p class="empty-title">No collections yet.</p><p class="empty-copy">Close this and use New collection on your board first.</p></div>`}
      ${picker.page || picker.hasMore ? `<nav class="content-pagination" aria-label="Collection picker pages"><button class="quiet-button" type="button" data-action="collection-picker-page" data-page="${Math.max(0, picker.page - 1)}" ${!picker.page || picker.loading || picker.busy ? 'disabled' : ''}>Previous</button><span>Page ${picker.page + 1}</span><button class="quiet-button" type="button" data-action="collection-picker-page" data-page="${picker.page + 1}" ${!picker.hasMore || picker.loading || picker.busy ? 'disabled' : ''}>Next</button></nav>` : ''}
      <div class="shelf-picker-actions"><button class="primary-button" type="button" data-action="collection-picker-close" data-post-id="${escapeHTML(picker.postId)}">Done</button></div>
    </div></div>`;
  }

  return {
    reset, ensure, load, afterBootstrap, afterMutation, afterRender, handleKeydown, handleBackdrop,
    snapshotForTest: () => cur, editorActive, handleClick, onRouteChange, submitCollectionForm,
    renderBoardSections, renderCollectionDetail, renderPicker, boardPagePosts, renderBoardPost,
    isPreview: () => cur.preview, canManage: manage, closePicker, hasPicker: () => Boolean(cur.picker),
  };
}
