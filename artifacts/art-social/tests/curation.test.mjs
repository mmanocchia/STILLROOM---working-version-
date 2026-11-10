import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const api = readFileSync(new URL('../src/api.js', import.meta.url), 'utf8').replace(/^export /gm, '').replaceAll('import.meta.env.BASE_URL', '"/"');
const curation = readFileSync(new URL('../src/curation.js', import.meta.url), 'utf8').replace(/^import .*$/m, '').replace(/^export /gm, '');

function load(fetchImpl) {
  const calls = [];
  const context = vm.createContext({ Headers, FormData, URLSearchParams, fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); } });
  vm.runInContext(`${api}\n${curation}\nthis.m = { getCuration, runCuration, parseBoardRoute, collectionRoute, mergeCurationDependencies, withoutCardIds };`, context);
  return { m: context.m, calls };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('parses board and collection routes', () => {
  const { m } = load(() => ok({}));
  assert.equal(JSON.stringify(m.parseBoardRoute('/board/b1')), '{"boardId":"b1","collectionId":null}');
  assert.equal(m.parseBoardRoute('/board/b1/collections/c%201').collectionId, 'c 1');
  assert.equal(m.parseBoardRoute('/board/b1/other'), null);
  assert.equal(m.collectionRoute('b 1', 'c'), '/board/b%201/collections/c');
});

test('GET and POST use the curation endpoint exactly', async () => {
  const { m, calls } = load(() => ok({ ok: true }));
  await m.getCuration('b1', { collectionId: 'c1', page: 2, collectionPage: 1 });
  await m.runCuration('b1', 'feature.set', { postId: 'p', active: true });
  assert.equal(calls[0].url, '/api/social/boards/b1/curation?collectionId=c1&page=2&collectionPage=1');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: 'feature.set', payload: { postId: 'p', active: true } });
});

test('merges only dependencies and strips duplicate card ids', () => {
  const { m } = load(() => ok({}));
  const merged = m.mergeCurationDependencies({ posts: [{ id: 'a', v: 1 }], accounts: [], boards: [], comments: [{ id: 'c', v: 'local' }], discovery: 'keep' },
    { posts: [{ id: 'b' }], accounts: [{ id: 'u' }], boards: [{ id: 'x' }], comments: [{ id: 'c', v: 'remote' }], shelves: [{ id: 's' }] });
  assert.equal(JSON.stringify(merged.posts.map((p) => p.id)), '["a","b"]');
  assert.equal(merged.comments[0].v, 'local');
  assert.equal('shelves' in merged || 'discovery' in merged, false);
  assert.equal(m.withoutCardIds('<article class="post-card" id="post-card-1">'), '<article class="post-card">');
});

function curationHarness() {
  const pending = [];
  const calls = [];
  const navigations = [];
  const context = vm.createContext({ Headers, FormData, URLSearchParams, Promise, document: { querySelector: () => null, getElementById: () => null, activeElement: null } });
  vm.runInContext(`${api}\n${curation}\nthis.createCuration = createCuration; this.patchCurationData = patchCurationData;`, context);
  const state = { route: '/board/b1', activeAccountId: 'artist', authLoading: false, posts: [], accounts: [{ id: 'artist', role: 'Artist' }], boards: [{ id: 'b1', ownerId: 'artist', artistName: 'Board' }], comments: [] };
  let generation = 1;
  const deferred = () => { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; };
  const cur = context.createCuration({
    state, escapeHTML: (v = '') => String(v), icon: () => '', hrefFor: (p) => p, renderEmpty: (t) => `<empty>${t}</empty>`,
    activeAccount: () => state.accounts.find((a) => a.id === state.activeAccountId) || null,
    render() {}, navigate: (path) => navigations.push(path), renderPostCard: (post) => `<article id="post-card-${post.id}"><form data-form="comment"></form></article>`,
    getAuthGeneration: () => generation,
    api: {
      getCuration: (boardId, options) => { const d = deferred(); calls.push({ type: 'get', boardId, options }); pending.push(d); return d.promise; },
      runCuration: (boardId, action, payload) => { const d = deferred(); calls.push({ type: 'post', boardId, action, payload }); pending.push(d); return d.promise; },
    },
  });
  return { cur, state, pending, calls, navigations, bumpAuth: () => { generation += 1; } };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const curationData = (extra = {}) => ({ boardId: 'b1', featuredPostIds: ['p1'], collections: [], collectionPagination: { page: 0, pageSize: 20, hasMore: false }, selectedCollection: null, collectionPostIds: [], postPagination: { page: 0, pageSize: 20, hasMore: false },
  snapshot: { posts: [{ id: 'p1', boardId: 'b1', authorId: 'fan', authorUsername: 'fan', content: 'old' }], accounts: [], boards: [], comments: [{ id: 'c1', postId: 'p1', content: 'old' }] }, ...extra });

test('late curation responses after leaving the board are ignored', async () => {
  const h = curationHarness();
  const load = h.cur.load();
  h.cur.onRouteChange('/board/b1', '/board/b2');
  h.state.route = '/board/b2';
  h.pending[0].resolve(curationData());
  await load;
  assert.equal(h.state.posts.length, 0);
});

test('a curation mutation finishing on another route reports nothing and does not navigate', async () => {
  const h = curationHarness();
  h.cur.handleClick('collection-delete-confirm', { dataset: { collectionId: 'c1' } });
  h.cur.onRouteChange('/board/b1', '/home');
  h.state.route = '/home';
  h.pending[0].resolve({ ok: true });
  await tick();
  assert.equal(h.navigations.length, 0);
  assert.equal(h.calls.filter((c) => c.type === 'get').length, 0);
  assert.equal(h.cur.editorActive(), false);
});

test('primary rows win over cached curation dependencies; deletes do not resurrect', async () => {
  const h = curationHarness();
  const load = h.cur.load();
  h.pending[0].resolve(curationData());
  await load;
  assert.equal(h.state.posts[0].content, 'old');
  h.state.posts = [{ id: 'p1', boardId: 'b1', authorId: 'fan', authorUsername: 'fan', content: 'fresh' }];
  h.cur.afterBootstrap(h.state.posts);
  assert.equal(h.state.posts.find((p) => p.id === 'p1').content, 'fresh');
  h.cur.afterMutation('comment.save', { commentId: 'c1' }, { comments: [{ id: 'c1', postId: 'p1', content: 'edited' }] });
  assert.equal(h.cur.snapshotForTest().data.snapshot.comments[0].content, 'edited');
  h.cur.afterMutation('comment.delete', { commentId: 'c1' }, {});
  assert.equal(h.cur.snapshotForTest().data.snapshot.comments.length, 0);
  h.cur.afterMutation('post.delete', { postId: 'p1' }, { posts: [] });
  h.state.posts = [];
  h.cur.afterBootstrap([]);
  assert.equal(h.state.posts.length, 0);
  assert.equal(h.cur.snapshotForTest().data.featuredPostIds.length, 0);
});

test('switching collection never renders the previous collection', async () => {
  const h = curationHarness();
  h.state.route = '/board/b1/collections/11111111-1111-4111-8111-111111111111';
  const load = h.cur.load();
  h.pending[0].resolve(curationData({ selectedCollection: { id: '11111111-1111-4111-8111-111111111111', title: 'First', postCount: 0 } }));
  await load;
  assert.match(h.cur.renderCollectionDetail(h.state.boards[0], '11111111-1111-4111-8111-111111111111'), /First/);
  const next = '/board/b1/collections/22222222-2222-4222-8222-222222222222';
  h.cur.onRouteChange(h.state.route, next);
  h.state.route = next;
  const html = h.cur.renderCollectionDetail(h.state.boards[0], '22222222-2222-4222-8222-222222222222');
  assert.doesNotMatch(html, /First/);
  assert.match(html, /aria-busy="true"/);
});

test('fresh curation reads update older dependency posts and restore Undo Repost metadata', async () => {
  const h = curationHarness();
  h.state.reposts = [];
  h.state.commentPagination = {};
  const first = h.cur.load();
  h.pending[0].resolve(curationData());
  await first;
  const next = curationData();
  next.snapshot.posts[0].content = 'Updated by the original Fan';
  next.snapshot.comments = [{ id: 'new-comment', postId: 'p1', content: 'Fresh comment' }];
  next.snapshot.reposts = [{ id: 'r1', postId: 'p1', userId: 'fan' }];
  next.snapshot.commentPagination = { p1: { hasMore: true, nextCursor: 'earlier' } };
  const refresh = h.cur.load({ force: true, background: true });
  h.pending[1].resolve(next);
  await refresh;
  assert.equal(h.state.posts.find((post) => post.id === 'p1').content, 'Updated by the original Fan');
  assert.equal(h.state.comments.some((comment) => comment.id === 'c1'), false);
  assert.equal(h.state.comments[0].content, 'Fresh comment');
  assert.equal(h.state.reposts[0].id, 'r1');
  assert.equal(h.state.commentPagination.p1.hasMore, true);
});

test('collection pagination replaces dependency windows but retains the primary Board page', async () => {
  const h = curationHarness();
  const primary = { id: 'primary', boardId: 'b1', content: 'Board page' };
  h.state.posts = [primary];
  h.cur.afterBootstrap([primary]);
  const first = h.cur.load();
  h.pending[0].resolve(curationData());
  await first;
  assert.equal(h.state.posts.some((post) => post.id === 'p1'), true);
  const second = h.cur.load({ force: true });
  const next = curationData();
  next.snapshot.posts = [{ id: 'p2', boardId: 'b1', content: 'Next collection page' }];
  next.snapshot.comments = [];
  h.pending[1].resolve(next);
  await second;
  assert.equal(JSON.stringify(h.state.posts.map((post) => post.id).sort()), '["p2","primary"]');
  assert.equal(h.state.comments.some((comment) => comment.postId === 'p1'), false);
});

test('public curation errors stay visible with retry', async () => {
  const h = curationHarness();
  h.state.activeAccountId = null;
  const load = h.cur.load();
  h.pending[0].reject(new Error('Curation unavailable'));
  await load;
  const html = h.cur.renderBoardSections(h.state.boards[0]);
  assert.match(html, /Curation unavailable/);
  assert.match(html, /data-action="curation-retry"/);
});

test('featured posts render one full card; the All Fan Posts copy is a reference', async () => {
  const h = curationHarness();
  const load = h.cur.load();
  h.pending[0].resolve(curationData());
  await load;
  const featured = h.cur.renderBoardSections(h.state.boards[0]);
  const post = h.state.posts.find((p) => p.id === 'p1');
  const all = h.cur.renderBoardPost(h.state.boards[0], post);
  assert.equal((featured + all).match(/id="post-card-p1"/g).length, 1);
  assert.equal((featured + all).match(/data-form="comment"/g).length, 1);
  assert.match(all, /Featured above/);
});

test('preview mode hides every owner control', async () => {
  const h = curationHarness();
  const load = h.cur.load();
  h.pending[0].resolve(curationData());
  await load;
  assert.match(h.cur.renderBoardSections(h.state.boards[0]), /feature-set/);
  h.cur.handleClick('curation-preview', { dataset: {} });
  const html = h.cur.renderBoardSections(h.state.boards[0]) + h.cur.renderBoardPost(h.state.boards[0], h.state.posts[0]);
  assert.doesNotMatch(html, /feature-set|collection-new|collection-picker-open|collection-move/);
});
