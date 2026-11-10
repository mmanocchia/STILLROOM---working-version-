import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the actual vanilla SPA handlers without starting Clerk or a server.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replaceAll('import.meta.env.BASE_URL', '"/"')
  .replace('void startStillroom();', '');

function harness() {
  let resolve;
  let reject;
  const request = new Promise((yes, no) => { resolve = yes; reject = no; });
  const node = { addEventListener() {}, querySelector() {}, querySelectorAll: () => [] };
  const context = vm.createContext({
    document: { querySelector: () => node, addEventListener() {} },
    window: {
      location: { pathname: '/home' },
      sessionStorage: { removeItem() {} },
      addEventListener() {},
    },
    history: { replaceState() {} },
    FormData: class {
      constructor(form) { this.values = form.values; }
      get(key) { return this.values[key]; }
    },
    URL,
    clearTimeout,
    clerk: null,
    runAction: () => request,
    getBootstrap: () => request,
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    const actualRender = render;
    render = () => {};
    navigate = (route) => { state.route = route; };
    state.accounts = [
      { id: 'fan', role: 'Fan', name: 'Fan', username: 'fan' },
      { id: 'artist', role: 'Artist', name: 'Artist', username: 'artist' }
    ];
    state.boards = [{ id: 'board', ownerId: 'artist', artistName: 'Board' }];
    state.activeAccountId = 'fan';
    state.authUserId = 'fan';
    state.authLoading = false;
    state.dataLoading = false;
  `, context);
  return {
    context,
    resolve,
    reject,
    run: (code) => vm.runInContext(code, context),
    snapshot: () => vm.runInContext('JSON.stringify(state)', context),
  };
}

test('guest navigation and both registration roles expose direct Sign In links', () => {
  const h = harness();
  h.run('state.activeAccountId = null; state.authUserId = null;');
  assert.match(h.run(`renderShell('', 'Feed')`), /data-testid="navigation-sign-in">Sign In<\/a>/);
  for (const role of ['Fan', 'Artist']) {
    h.run(`state.pendingRole = '${role}';`);
    const html = h.run('renderRegistration()');
    assert.match(html, /Already have an account\?/);
    assert.match(html, /href="\/login" data-route="\/login"/);
  }
  assert.match(h.run('renderLogin()'), /Don't have an account\?/);
  assert.match(h.run('renderLogin()'), /data-testid="login-sign-up">Sign Up<\/a>/);
});

for (const role of ['Fan', 'Artist']) {
  test(`existing ${role} session restores its profile on login and refresh without onboarding`, async () => {
    const h = harness();
    h.run(`state.route = '/login'; state.activeAccountId = null; state.authUserId = null;`);
    const pending = h.run('syncSession()');
    h.resolve({
      userId: 'existing', profileId: 'existing',
      accounts: [{ id: 'existing', role, name: 'Existing member', username: 'existing' }],
      boards: [], posts: [], shelves: [],
    });
    await pending;
    assert.equal(h.run('state.route'), '/home');
    assert.equal(h.run('activeAccount().id'), 'existing');
    assert.equal(h.run('activeAccount().role'), role);
    assert.doesNotMatch(h.run(`renderShell('', 'Feed')`), /data-testid="navigation-sign-in"/);
    assert.match(h.run(`renderShell('', 'Feed')`), /data-action="logout"/);
    await h.run('syncSession()');
    assert.equal(h.run('state.accounts.length'), 1);
    assert.equal(h.run('activeAccount().id'), 'existing');
  });
}

const fanResponse = {
  userId: 'fan', profileId: 'fan',
  accounts: [{ id: 'fan', role: 'Fan' }, { id: 'artist', role: 'Artist' }],
  boards: [{ id: 'board', ownerId: 'artist' }],
  posts: [{ id: 'post', boardId: 'board', authorId: 'fan' }],
  shelves: [{ id: 'secret', ownerId: 'fan', visibility: 'private' }],
  postDrafts: { private: { content: 'private Fan draft' } },
  followedArtistsByFan: { fan: ['artist'] },
};

for (const handler of ['submitPost', 'submitBoard']) {
  for (const outcome of ['success', 'failure']) {
    test(`${handler}: late ${outcome} cannot change the next account or its editor`, async () => {
      const h = harness();
      if (handler === 'submitBoard') {
        h.run(`state.activeAccountId = 'artist'; state.authUserId = 'artist';`);
      }
      const pending = h.run(handler === 'submitPost'
        ? `submitPost({
            dataset: { boardId: 'board' },
            values: { postContent: 'Fan publication' }
          })`
        : `submitBoard({
            dataset: { mode: 'edit' },
            values: { artistName: 'Old Artist', discipline: 'Painting', biography: 'Old biography' }
          })`);
      h.run(`
        authGeneration += 1;
        clearAccountEditors();
        state.activeAccountId = '${handler === 'submitPost' ? 'artist' : 'fan'}';
        state.authUserId = state.activeAccountId;
        state.route = '/profile';
        state.postEditor = { key: 'new-session-editor' };
        state.postPublishing = true;
        state.pendingPost = { key: 'new-session-pending' };
        state.boardDraft = { artistName: 'New session draft' };
        state.boardLoading = true;
        state.pendingBoard = { mode: 'new-session-pending' };
      `);
      const before = h.snapshot();
      if (outcome === 'success') h.resolve(fanResponse);
      else h.reject(new Error('Old-session server failure'));
      await pending;
      assert.equal(h.snapshot(), before, 'stale success, catch, and finally must all be inert');
    });
  }
}

test('ordinary post success still applies data and completes the editor', async () => {
  const h = harness();
  const pending = h.run(`submitPost({
    dataset: { boardId: 'board' }, values: { postContent: 'Published' }
  })`);
  h.resolve(fanResponse);
  await pending;
  assert.equal(h.run('state.activeAccountId'), 'fan');
  assert.equal(h.run('state.posts[0].id'), 'post');
  assert.equal(h.run('state.postPublishing'), false);
  assert.equal(h.run('state.pendingPost'), null);
  assert.equal(h.run('state.postStatus.message'), 'Your post is live.');
});

test('ordinary Board success still applies data and navigates to the Board', async () => {
  const h = harness();
  h.run(`state.activeAccountId = 'artist'; state.authUserId = 'artist';`);
  const pending = h.run(`submitBoard({
    dataset: { mode: 'edit' },
    values: { artistName: 'Artist', discipline: 'Painting', biography: 'Biography' }
  })`);
  h.resolve({ ...fanResponse, userId: 'artist', profileId: 'artist', shelves: [], postDrafts: {} });
  await pending;
  assert.equal(h.run('state.activeAccountId'), 'artist');
  assert.equal(h.run('state.route'), '/board/board');
  assert.equal(h.run('state.boardLoading'), false);
  assert.equal(h.run('state.boardDraft'), null);
});

test('auth reset releases account-specific pending flags and private editor state', () => {
  const h = harness();
  h.run(`
    state.boardLoading = state.postPublishing = state.shelfLoading = true;
    state.pendingBoard = state.pendingPost = state.pendingShelf = { ownerId: 'fan' };
    state.commentPending = state.repostPending = { userId: 'fan' };
    state.followStatus = { pending: true, userId: 'fan' };
    state.shelfReturnPostId = 'private-return';
    state.shelfReturnRoute = '/private-return';
    state.boardErrors = state.commentErrors = { private: 'old account text' };
    state.shelves = [{ visibility: 'private' }, { visibility: 'public' }];
    state.postDrafts = { private: { content: 'private draft' } };
    clearAccountEditors();
  `);
  assert.equal(h.run(`[
    state.boardLoading, state.postPublishing, state.shelfLoading,
    state.pendingBoard, state.pendingPost, state.pendingShelf,
    state.commentPending, state.repostPending, state.followStatus,
    state.shelfReturnPostId, state.shelfReturnRoute
  ].some(Boolean)`), false);
  assert.equal(h.run('Object.keys(state.postDrafts).length'), 0);
  assert.equal(h.run('Object.keys(state.commentErrors).length'), 0);
  assert.equal(h.run('state.shelves.length'), 1);
  assert.equal(h.run('state.shelves[0].visibility'), 'public');
});

test('session change removes private DOM immediately while the old bootstrap is pending', () => {
  const h = harness();
  h.run(`
    render = actualRender;
    state.route = '/shelves/private';
    state.shelves = [{ id: 'private', ownerId: 'fan', visibility: 'private' }];
    document.querySelector('#app').innerHTML = '<section>Old private Shelf and draft text</section>';
    // An earlier bootstrap remains unresolved throughout this assertion.
    syncInFlight = new Promise(() => {});
    observedClerkSession = 'old-fan-session';
    handleClerkSession({ session: { id: 'new-artist-session' } });
  `);
  const html = h.run(`document.querySelector('#app').innerHTML`);
  assert.doesNotMatch(html, /Old private Shelf|draft text/);
  assert.match(html, /Loading Stillroom/);
  assert.equal(h.run('state.activeAccountId'), null);
  assert.equal(h.run('state.authLoading && state.dataLoading'), true);
  assert.equal(h.run('state.shelves.length'), 0);
});
