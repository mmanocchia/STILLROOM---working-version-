import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { appendPublicSnapshot, patchInteraction, PUBLIC_WINDOW_LIMIT } from '../src/publicContent.js';

// Exercise the actual vanilla SPA handlers without starting Clerk or a server.
const curationSource = readFileSync(new URL('../src/curation.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const settingsSource = readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const source = curationSource + settingsSource + readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replaceAll('import.meta.env.BASE_URL', '"/"')
  .replace('void startStillroom();', '');

function harness(initialPath = '/home') {
  let resolve;
  let reject;
  const request = new Promise((yes, no) => { resolve = yes; reject = no; });
  const node = { addEventListener() {}, querySelector() {}, querySelectorAll: () => [] };
  const context = vm.createContext({
    document: { querySelector: () => node, addEventListener() {} },
    window: {
      location: { pathname: initialPath },
      sessionStorage: { removeItem() {}, getItem() { return null; }, setItem() {} },
      addEventListener() {},
      setInterval() {},
      clearTimeout,
      setTimeout,
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
    appendPublicSnapshot,
    patchInteraction,
    PUBLIC_WINDOW_LIMIT,
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

test('content selection follows Board, post, profile, private-follow and Shelf routes', () => {
  const h = harness();
  h.run(`state.route = '/board/board-id'; state.contentPage = 2;`);
  assert.equal(h.run('JSON.stringify(contentSelection())'), JSON.stringify({ page: 2, shelfPage: 0, boardId: 'board-id' }));
  h.run(`state.route = '/home'; state.homeTab = 'my-artists';`);
  assert.equal(h.run('contentSelection().followed'), 'true');
  h.run(`state.route = '/profile/fan'; state.profileActivityTabs.fan = 'reposts';`);
  assert.equal(h.run('contentSelection().repostsBy'), 'fan');
  assert.equal(h.run('contentSelection().mine'), undefined);
  h.run(`state.route = '/shelves/shelf-id';`);
  assert.equal(h.run('contentSelection().shelfId'), 'shelf-id');
  h.run(`state.route = '/post/post-id';`);
  assert.equal(h.run('contentSelection().postId'), 'post-id');
});

test('Feed stays newest-first and My Artists filters Boards without popularity signals', () => {
  const h = harness();
  h.run(`
    state.boards.push({ id: 'other-board', ownerId: 'other-artist' });
    state.accounts.push({ id: 'other-artist', role: 'Artist' });
    state.posts = [
      { id: 'newest', authorId: 'fan', boardId: 'other-board', publishedAt: 3 },
      { id: 'middle', authorId: 'fan', boardId: 'board', publishedAt: 2 },
      { id: 'oldest', authorId: 'fan', boardId: 'board', publishedAt: 1 }
    ];
  `);
  assert.equal(h.run(`homeFeedItems().map(item => item.post.id).join(',')`), 'newest,middle,oldest');
  assert.equal(h.run(`homeFeedItems(new Set(['artist'])).map(item => item.post.id).join(',')`), 'middle,oldest');
  assert.equal(h.run(`homeFeedItems(new Set()).length`), 0);
});

test('Artists can write and manage their own comments without publishing permissions', async () => {
  const h = harness();
  h.run(`state.activeAccountId = 'artist'; state.authUserId = 'artist';
    state.posts = [{ id: 'post', boardId: 'board', authorId: 'fan' }];`);
  assert.match(h.run(`renderCommentForm(state.posts[0])`), /Post comment/);
  let sent;
  h.context.runAction = (action, payload) => { sent = { action, payload }; return Promise.resolve({
    userId: 'artist', profileId: 'artist', accounts: [{ id: 'artist', role: 'Artist' }],
    posts: [{ id: 'post', boardId: 'board', authorId: 'fan' }], comments: [],
  }); };
  await h.run(`submitComment({ dataset: { postId: 'post' }, values: { commentContent: 'A note from the Artist.' } })`);
  assert.equal(sent.action, 'comment.save');
  assert.equal(sent.payload.content, 'A note from the Artist.');
  const markup = h.run(`renderCommentItem({id:'c',postId:'post',authorId:'artist',authorUsername:'artist',
    authorRole:'Artist',officialArtist:true,createdAt:1,content:'<script>unsafe</script>'})`);
  assert.match(markup, /Board owner/);
  assert.match(markup, /data-action="edit-comment"/);
  assert.doesNotMatch(markup, /<script>unsafe/);
});

test('Undo Repost sends the captured false state after closing its confirmation', async () => {
  const h = harness();
  h.run(`state.posts=[{ id:'post', boardId:'board', authorId:'fan' }];
    state.reposts=[{id:'repost',userId:'fan',postId:'post'}];
    state.repostConfirm={postId:'post',userId:'fan',action:'undo'};`);
  let sent;
  h.context.runAction = (action, payload) => { sent = { action, payload }; return Promise.resolve(fanResponse); };
  await h.run(`confirmRepost('post')`);
  assert.equal(sent.action, 'repost.set');
  assert.equal(sent.payload.active, false);
});

test('Repost-only Feed dependencies do not manufacture a second original Feed entry', () => {
  const h = harness();
  h.run(`state.posts=[{id:'old',boardId:'board',authorId:'fan',publishedAt:1}];
    state.reposts=[{id:'recent',userId:'fan',postId:'old',repostedAt:2}];
    state.discovery={postIds:[],repostIds:['recent'],artistIds:[],boardIds:[]};`);
  assert.equal(h.run('homeFeedItems().length'), 1);
  assert.equal(h.run('homeFeedItems()[0].type'), 'repost');
});

test('public view requests carry cursor context and visitors get a My Artists sign-in prompt', () => {
  const h = harness();
  h.run(`state.route = '/home'; state.contentCursor = 'cursor-token';`);
  assert.equal(h.run('contentSelection().view'), 'feed');
  assert.equal(h.run('contentSelection().cursor'), 'cursor-token');
  h.run(`state.route = '/explore'; state.exploreQuery = '@name'; state.exploreDiscipline = 'Music';`);
  assert.equal(h.run('contentSelection().view'), 'explore');
  assert.equal(h.run('contentSelection().q'), '@name');
  assert.equal(h.run('contentSelection().category'), 'Music');
  h.run(`state.route = '/home'; state.contentCursor = null; state.activeAccountId = null; state.authUserId = null; state.homeTab = 'my-artists';`);
  assert.match(h.run('renderHome()'), /href="\/login" data-route="\/login">Sign In/);
});

test('Load More applies an additional page but ignores responses after a filter change', async () => {
  const h = harness();
  h.context.clerk = { loaded: true };
  h.run(`state.contentCursor = 'cursor-token'; state.posts = [{ id: 'one', boardId: 'board', authorId: 'fan' }];`);
  const pending = h.run('refreshPublicContent({ append: true })');
  h.resolve({ userId: 'fan', profileId: 'fan', accounts: [{ id: 'fan', role: 'Fan' }],
    posts: [{ id: 'two', boardId: 'board', authorId: 'fan' }], boards: [{ id: 'board', ownerId: 'artist' }] });
  await pending;
  assert.equal(h.run(`state.posts.map(post => post.id).join(',')`), 'one,two');
  const other = harness();
  other.context.clerk = { loaded: true };
  other.run(`state.contentCursor = 'cursor-token';`);
  const stale = other.run('refreshPublicContent({ append: true })');
  other.run(`state.homeTab = 'my-artists'; state.contentCursor = null;`);
  other.resolve({ userId: 'fan', profileId: 'fan', posts: [{ id: 'wrong-feed' }] });
  await stale;
  assert.equal(other.run('state.posts.length'), 0);
});

test('a public refresh replaces its post page instead of accumulating all posts', async () => {
  const h = harness();
  h.context.clerk = { loaded: true };
  h.run(`state.posts = [{ id: 'previous-page' }]; state.contentPage = 1;`);
  const pending = h.run('refreshPublicContent()');
  h.resolve({
    userId: 'fan', profileId: 'fan', accounts: [{ id: 'fan', role: 'Fan' }],
    posts: [{ id: 'next-page' }], pagination: { page: 1, pageSize: 20, hasMore: true },
  });
  await pending;
  assert.equal(h.run('state.posts.length'), 1);
  assert.equal(h.run('state.posts[0].id'), 'next-page');
  assert.equal(h.run('state.contentPagination.hasMore'), true);
});

test('a public refresh cannot apply a result after switching accounts', async () => {
  const h = harness();
  h.context.clerk = { loaded: true };
  const pending = h.run('refreshPublicContent()');
  h.run(`authGeneration += 1; clearAccountEditors(); state.activeAccountId = 'artist'; state.authUserId = 'artist';`);
  const before = h.snapshot();
  h.resolve(fanResponse);
  await pending;
  assert.equal(h.snapshot(), before);
});

test('a completed mutation cannot replace a newly selected feed with its old view snapshot', async () => {
  const h = harness();
  h.context.clerk = { loaded: true };
  h.run(`state.route = '/board/board';`);
  const pending = h.run(`persistAction('follow.toggle', { artistId: 'board' })`);
  h.run(`state.route = '/home'; state.homeTab = 'my-artists';`);
  h.context.getBootstrap = async () => ({ userId: 'fan', profileId: 'fan',
    accounts: [{ id: 'fan', role: 'Fan' }], posts: [{ id: 'current-view' }] });
  h.resolve({ userId: 'fan', profileId: 'fan', posts: [{ id: 'old-view' }] });
  await pending;
  assert.equal(h.run('state.posts[0].id'), 'current-view');
});

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

test('a successful session reload clears an obsolete public refresh error', async () => {
  const h = harness('/explore');
  h.run(`state.contentRefreshError = 'Could not reach Stillroom. Check your connection and try again.';`);
  const pending = h.run('syncSession()');
  h.resolve({ userId: 'fan', profileId: 'fan', accounts: [], boards: [], posts: [] });
  await pending;
  assert.equal(h.run('state.contentRefreshError'), '');
});

test('failed public refresh preserves existing posts, boards and profiles', async () => {
  const h = harness('/explore');
  h.run(`
    clerk = { loaded: true };
    state.posts = [{ id: 'existing', boardId: 'board', authorId: 'fan' }];
    renderPublicContent = () => {};
  `);
  const pending = h.run('refreshPublicContent()');
  h.reject(Object.assign(new Error('Stillroom’s server could not complete this request (HTTP 500).'), { status: 500 }));
  await pending;
  assert.equal(h.run('state.posts[0].id'), 'existing');
  assert.equal(h.run('state.boards[0].id'), 'board');
  assert.equal(h.run('state.accounts.length'), 2);
  assert.match(h.run('state.contentRefreshError'), /HTTP 500/);
});

test('compact Fan profile shows identity and owner-only editing, Settings and private Artists', () => {
  const h = harness('/profile');
  h.run(`
    state.accounts[0].biography = 'Personal biography';
    state.accounts[0].interests = 'Film and music';
    state.followedArtistsByFan = { fan: ['artist'] };
  `);
  const owner = h.run('renderProfile()');
  assert.match(owner, /@fan/);
  assert.match(owner, /Personal biography/);
  assert.match(owner, /Film and music/);
  assert.match(owner, /data-action="edit-profile"/);
  assert.match(owner, /data-route="\/settings"/);
  assert.match(owner, /data-action="switch-account"/);
  assert.match(owner, /sr-following-face/);
  assert.match(owner, /data-route="\/board\/board"/);
  h.run(`state.activeAccountId = 'artist';`);
  const other = h.run(`renderPublicProfile('fan')`);
  assert.doesNotMatch(other, /data-action="edit-profile"|data-route="\/settings"|sr-following-face|data-action="switch-account"/);
});

test('profile Shelf tabs include private Shelves only for their owner', () => {
  const h = harness();
  h.run(`
    state.profileActivityTabs.fan = 'shelves';
    state.shelves = [
      { id: 'private-id', ownerId: 'fan', title: 'Private title', visibility: 'private', postIds: [] },
      { id: 'public-id', ownerId: 'fan', title: 'Public title', visibility: 'public', postIds: [] }
    ];
  `);
  assert.match(h.run(`renderPublicProfile('fan')`), /Private title/);
  assert.match(h.run(`renderPublicProfile('fan')`), /data-action="create-shelf"/);
  for (const account of ['artist', null]) {
    h.context.viewer = account;
    h.run(`state.activeAccountId = viewer;`);
    const other = h.run(`renderPublicProfile('fan')`);
    assert.match(other, /Public title/);
    assert.doesNotMatch(other, /Private title|private-id|data-action="create-shelf"/);
  }
});

test('Artist profile keeps Board contributions, Board link and no publishing controls', () => {
  const h = harness('/profile');
  h.run(`
    state.activeAccountId = 'artist';
    state.boards[0].biography = 'Board biography';
    state.boards[0].discipline = 'Music';
    state.posts = [{ id: 'contribution', authorId: 'fan', authorUsername: 'fan',
      boardId: 'board', content: 'Fan contribution', publishedAt: 1 }];
  `);
  const html = h.run('renderProfile()');
  assert.match(html, /@artist/);
  assert.match(html, /Music · Artist/);
  assert.match(html, /Board biography/);
  assert.match(html, /data-testid="link-artist-board"/);
  assert.match(html, /data-route="\/post\/contribution"/);
  assert.doesNotMatch(html, /data-action="(?:create-post|publish-post|start-post)"/);
  h.run(`state.profileActivityTabs.artist = 'reposts';`);
  assert.equal(h.run('contentSelection().profileId'), 'artist');
  assert.equal(h.run('contentSelection().repostsBy'), 'artist');
});

test('own Fan profile requests private followed-Board metadata but public profiles do not', () => {
  const h = harness('/profile');
  assert.equal(h.run('contentSelection().artistList'), 'true');
  h.run(`state.route = '/profile/fan'; state.activeAccountId = 'artist';`);
  assert.equal(h.run('contentSelection().artistList'), undefined);
});

test('profile Edit action still opens original forms and Cancel retains profile data', () => {
  const h = harness();
  h.run('beginProfileEdit()');
  assert.equal(h.run('state.editingProfile'), true);
  const html = h.run('renderProfile()');
  assert.match(html, /data-form="profile"/);
  assert.match(html, /data-action="open-username-editor"/);
  assert.match(html, /data-action="cancel-profile-edit"/);
  h.run('cancelProfileEdit()');
  assert.equal(h.run('state.editingProfile'), false);
  assert.equal(h.run('activeAccount().username'), 'fan');
  h.run(`state.activeAccountId = 'artist'; beginProfileEdit();`);
  assert.equal(h.run('state.route'), '/artists/edit');
  assert.equal(h.run('state.boardDraft.artistName'), 'Board');
});

test('profile grid preserves image/video/text links, original authors and Board credits', () => {
  const h = harness();
  h.run(`state.posts = [
    { id: 'image', authorId: 'fan', authorUsername: 'fan', boardId: 'board', content: '', publishedAt: 1, media: { type: 'image', url: '/image' } },
    { id: 'video', authorId: 'fan', authorUsername: 'fan', boardId: 'board', content: '', publishedAt: 2, media: { type: 'video', url: '/video' } },
    { id: 'text', authorId: 'fan', authorUsername: 'fan', boardId: 'board', content: '<script>unsafe</script>', publishedAt: 3 }
  ];`);
  const html = h.run('renderProfile()');
  for (const id of ['image', 'video', 'text']) assert.match(html, new RegExp(`data-route="/post/${id}"`));
  assert.match(html, /<img class="sr-tile-media"/);
  assert.match(html, /<video class="sr-tile-media"/);
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(html, /sr-tile-author">@fan/);
  assert.match(html, /sr-tile-board">on Board/);
});

test('own repost profile grid preserves confirmation, pending and error feedback', () => {
  const h = harness();
  h.run(`
    state.accounts.push({ id: 'other', role: 'Fan', name: 'Other', username: 'other' });
    state.posts = [{ id: 'post', authorId: 'other', authorUsername: 'other', boardId: 'board', content: 'Post', publishedAt: 1 }];
    state.reposts = [{ id: 'repost', postId: 'post', userId: 'fan', repostedAt: 2 }];
    state.profileActivityTabs.fan = 'reposts';
  `);
  assert.match(h.run('renderProfile()'), /data-action="toggle-repost"/);
  h.run(`toggleRepost('post')`);
  assert.match(h.run('renderProfile()'), /data-action="confirm-repost"/);
  assert.match(h.run('renderProfile()'), /data-action="cancel-repost"/);
  h.run(`state.repostConfirm = null; state.repostPending = { postId: 'post', userId: 'fan' };`);
  assert.match(h.run('renderProfile()'), /Undoing…/);
  h.run(`state.repostPending = null; state.repostStatus = { userId: 'fan', kind: 'error', message: 'Could not undo.' };`);
  assert.match(h.run('renderProfile()'), /role="alert">Could not undo/);
  h.run(`state.activeAccountId = 'other';`);
  assert.doesNotMatch(h.run(`renderPublicProfile('fan')`), /data-action="toggle-repost"|Could not undo/);
});

test('profile empty states and tab labels are compact and accessible without fake identities', () => {
  const h = harness();
  const own = h.run('renderProfile()');
  assert.match(own, /No posts yet/);
  assert.doesNotMatch(own, /Your corner|About Me|class="empty-state"/);
  for (const label of ['Posts', 'Reposts', 'Shelves']) assert.match(own, new RegExp(`aria-label="${label}"`));
  h.run(`state.activeAccountId = null;`);
  const guest = h.run('renderProfile()');
  assert.match(guest, /Join Stillroom/);
  assert.match(guest, /data-route="\/login"/);
  assert.doesNotMatch(guest, /@fan|@artist|data-action="edit-profile"|data-route="\/settings"/);
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

test('direct Settings, recovery, status and onboarding links survive initial route validation', () => {
  for (const path of ['/settings', '/recover', '/deletion-status', '/profile/setup']) {
    const h = harness(path);
    assert.equal(h.run('state.route'), path);
  }
});

test('Edit board initializes cover, creative description and profile asset fields', () => {
  const h = harness();
  h.run(`state.activeAccountId = 'artist'; state.boardCoverLoading = true; state.boardCoverError = 'x';
    state.boards = [{ id: 'board', ownerId: 'artist', artistName: 'Board', discipline: 'Music', biography: 'Bio',
      profileImage: '/p', profileImageAssetId: 'pa', coverImage: '/c', coverImageAssetId: 'ca', creativeDescription: 'Lines' }];
    beginBoardForm('edit');`);
  const draft = JSON.parse(h.run('JSON.stringify(state.boardDraft)'));
  assert.equal(draft.coverImageAssetId, 'ca');
  assert.equal(draft.coverImage, '/c');
  assert.equal(draft.creativeDescription, 'Lines');
  assert.equal(draft.profileImageAssetId, 'pa');
  assert.equal(h.run('state.boardCoverLoading'), false);
  assert.equal(h.run('state.boardCoverError'), '');
  h.run('state.boardDraft = null; state.route = "/artists/edit"; renderBoardForm("edit");');
  assert.equal(JSON.parse(h.run('JSON.stringify(state.boardDraft)')).coverImageAssetId, 'ca');
});
