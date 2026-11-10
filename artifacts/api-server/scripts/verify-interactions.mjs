// Opt-in development integration audit. Never creates users, Boards, or posts.
// Requires explicit permission to create and clean up temporary interactions.
import { clerkClient } from '@clerk/express';
import { randomUUID } from 'node:crypto';

if (!process.argv.includes('--allow-temporary-interactions')) {
  throw new Error('Explicit permission is required: --allow-temporary-interactions');
}
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
if (!process.env.REPLIT_DEV_DOMAIN?.endsWith('.replit.dev')) throw new Error('Development domain required.');
const marker = `Verification ${randomUUID().slice(0, 8)}`;
const contexts = [];
const createdComments = [];
const createdShelves = [];
let createdRepost = false, fan, artist, post;
let passed = 0;
function check(label, condition) {
  console.log(condition ? 'PASS' : 'FAIL', label);
  if (!condition) throw new Error(label);
  passed++;
}
async function request(context, path, body, expected = [200]) {
  const headers = { Origin: origin };
  if (context) {
    if (!context.jwt || Date.now() > context.refreshAt) {
      const token = await clerkClient.sessions.getToken(context.sessionId);
      context.jwt = token.jwt;
      context.refreshAt = Date.now() + 40000;
    }
    headers.Authorization = `Bearer ${context.jwt}`;
  }
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + '/api/social/' + path, {
    method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (!expected.includes(response.status)) throw new Error(`Unexpected HTTP ${response.status} for ${path.split('?')[0]}`);
  return { status: response.status, data: await response.json() };
}
const action = async (context, name, payload, expected) =>
  (await request(context, 'actions?view=feed', { action: name, payload }, expected)).data;
async function session(account) {
  const existing = await clerkClient.users.getUser(account.id);
  check(`Existing ${account.role} provider identity`, existing.id === account.id);
  const created = await clerkClient.sessions.createSession({ userId: existing.id });
  const context = { userId: existing.id, role: account.role, sessionId: created.id };
  contexts.push(context);
  const { data } = await request(context, 'bootstrap?view=feed');
  check(`Real ${account.role} session restores the exact existing profile`, data.profileId === existing.id
    && data.accounts.some((row) => row.id === existing.id && row.role === account.role));
  return context;
}
try {
  const { data: initial } = await request(null, 'bootstrap?view=feed');
  post = initial.posts[0];
  if (!post) throw new Error('An existing public Fan post is required.');
  const board = initial.boards.find((row) => row.id === post.boardId);
  const fanAccount = initial.accounts.find((row) => row.id === post.authorId && row.role === 'Fan');
  const artistAccount = initial.accounts.find((row) => row.id === board?.ownerId && row.role === 'Artist');
  if (!fanAccount || !artistAccount) throw new Error('Existing Fan and Board-owner Artist are required.');
  fan = await session(fanAccount);
  artist = await session(artistAccount);
  const artistFeed = (await request(artist, 'bootstrap?view=feed')).data;
  check('A different authenticated Artist retrieves the original Fan post from the shared database',
    artistFeed.posts.some((row) => row.id === post.id && row.authorId === fan.userId));

  const fanResult = await action(fan, 'comment.save', { postId: post.id, content: `${marker} Fan comment` });
  createdComments.push({ id: fanResult.commentResult.id, context: fan });
  const artistResult = await action(artist, 'comment.save', { postId: post.id, content: `${marker} Artist comment` });
  createdComments.push({ id: artistResult.commentResult.id, context: artist });
  const publicComments = (await request(null, `comments?postId=${post.id}`)).data.comments;
  check('Both roles persist guest-readable comments with trusted author metadata',
    publicComments.some((row) => row.id === fanResult.commentResult.id && row.authorRole === 'Fan')
    && publicComments.some((row) => row.id === artistResult.commentResult.id && row.authorRole === 'Artist' && row.officialArtist));
  const edited = await action(fan, 'comment.save', { postId: post.id, commentId: fanResult.commentResult.id, content: `${marker} Fan edited` });
  check('Own comment edit persists', edited.commentResult.content === `${marker} Fan edited`);
  await action(artist, 'comment.save', { postId: post.id, commentId: fanResult.commentResult.id, content: `${marker} Forbidden edit` }, [403, 404]);
  await action(fan, 'comment.delete', { commentId: artistResult.commentResult.id }, [403, 404]);
  check('Other-account comment edit/delete rejected', true);
  const artistRead = (await request(artist, `comments?postId=${post.id}`)).data.comments;
  check('Other authenticated account reads the edited Fan comment', artistRead.some((row) =>
    row.id === fanResult.commentResult.id && row.content === `${marker} Fan edited`));

  const beforeReposts = (await request(fan, 'bootstrap?view=feed')).data.reposts;
  if (!beforeReposts.some((row) => row.userId === fan.userId && row.postId === post.id)) {
    // Mark before the request: cleanup also handles a successful write whose response failed.
    createdRepost = true;
    await action(fan, 'repost.set', { postId: post.id, active: true });
    const repeated = await action(fan, 'repost.set', { postId: post.id, active: true });
    check('Repeated Repost create is idempotent', repeated.reposts.filter((row) =>
      row.userId === fan.userId && row.postId === post.id).length === 1);
    const guestFeed = (await request(null, 'bootstrap?view=feed')).data;
    check('Guest Feed includes an attributed relationship, not a copied original',
      guestFeed.reposts.some((row) => row.userId === fan.userId && row.postId === post.id)
      && guestFeed.posts.filter((row) => row.id === post.id).length === 1);
    const profile = (await request(null, `bootstrap?repostsBy=${fan.userId}`)).data;
    check('Public profile Reposts source references the original', profile.reposts.some((row) =>
      row.postId === post.id && row.userId === fan.userId));
    await action(fan, 'repost.set', { postId: post.id, active: false });
    await action(fan, 'repost.set', { postId: post.id, active: false });
    check('Repeated Undo is idempotent', !(await request(null, 'bootstrap?view=feed')).data.reposts.some((row) =>
      row.userId === fan.userId && row.postId === post.id));
    createdRepost = false;
  }
  await action(artist, 'repost.set', { postId: post.id, active: true }, [403]);
  await action(artist, 'post.save', { boardId: post.boardId, content: '', mediaAssetId: null }, [403]);
  check('Artists cannot repost or publish', true);

  for (const visibility of ['private', 'public']) {
    const title = `${marker} ${visibility}`;
    const saved = await action(fan, 'shelf.save', { shelfId: null, title, description: 'Temporary verification', visibility });
    const shelf = saved.shelves.find((row) => row.title === title);
    if (!shelf) throw new Error('Created Shelf missing from response');
    createdShelves.push(shelf.id);
    await action(fan, 'shelf.addPost', { shelfId: shelf.id, postId: post.id });
    await action(fan, 'shelf.addPost', { shelfId: shelf.id, postId: post.id });
    const own = (await request(fan, `bootstrap?shelfId=${shelf.id}`)).data;
    check(`${visibility} Shelf saves without duplicate memberships`, own.shelves[0].savedCount === 1
      && own.posts.some((row) => row.id === post.id));
  }
  const [privateId, publicId] = createdShelves;
  await request(null, `bootstrap?shelfId=${privateId}`, undefined, [404]);
  await request(artist, `bootstrap?shelfId=${privateId}`, undefined, [404]);
  const publicProfile = (await request(artist, `bootstrap?profileId=${fan.userId}`)).data;
  check('Private Shelf hidden from guest and other account; public Shelf visible',
    publicProfile.shelves.some((row) => row.id === publicId) && !publicProfile.shelves.some((row) => row.id === privateId));
  await action(artist, 'shelf.save', { shelfId: privateId, title: `${marker} Forbidden`, description: '', visibility: 'public' }, [403, 404]);
  await action(fan, 'shelf.save', { shelfId: privateId, title: `${marker} renamed`, description: 'Updated verification', visibility: 'public' });
  check('Own Shelf rename and public visibility update persist',
    (await request(null, `bootstrap?shelfId=${privateId}`)).data.shelves.some((row) => row.title === `${marker} renamed`));
  await action(fan, 'shelf.save', { shelfId: privateId, title: `${marker} renamed`, description: '', visibility: 'private' });
  await request(null, `bootstrap?shelfId=${privateId}`, undefined, [404]);
  await action(fan, 'shelf.setPosts', { postId: post.id, shelfIds: [], scopeShelfIds: [privateId] });
  const first = (await request(fan, `bootstrap?shelfId=${privateId}`)).data;
  const second = (await request(fan, `bootstrap?shelfId=${publicId}`)).data;
  check('Removing from loaded scope preserves saves in other Shelves and original post',
    first.shelves[0].savedCount === 0 && second.shelves[0].savedCount === 1
    && (await request(null, 'bootstrap?view=feed')).data.posts.some((row) => row.id === post.id));
  await action(fan, 'shelf.setPosts', { postId: post.id, shelfIds: [privateId, publicId, publicId], scopeShelfIds: [privateId, publicId] });
  check('One post can be saved to multiple Shelves',
    (await request(fan, `bootstrap?shelfId=${privateId}`)).data.shelves[0].savedCount === 1);
  const renewedFan = await session(fanAccount);
  const restored = (await request(renewedFan, `bootstrap?shelfId=${privateId}`)).data;
  check('A new real session restores persisted private Shelf data without creating a profile',
    restored.profileId === fan.userId && restored.shelves[0].savedCount === 1);
} catch (error) {
  process.exitCode = 1;
  // SDK errors can contain credentials/headers. Never dump them.
  console.error('AUDIT STOPPED:', error.constructor.name === 'Error' ? error.message : error.constructor.name);
} finally {
  if (fan && post) {
    try {
      const rows = (await request(null, `comments?postId=${post.id}`)).data.comments;
      const deletions = new Map(createdComments.map((row) => [row.id, row.context]));
      for (const row of rows.filter((row) => row.content.startsWith(marker))) {
        const context = contexts.find((item) => item.userId === row.authorId);
        if (context) deletions.set(row.id, context);
      }
      for (const [commentId, context] of deletions) await action(context, 'comment.delete', { commentId }, [200, 404]);
      const shelves = (await request(fan, `shelves?ownerId=${fan.userId}`)).data.shelves;
      const ids = new Set([...createdShelves, ...shelves.filter((row) => row.title.startsWith(marker)).map((row) => row.id)]);
      for (const shelfId of ids) await action(fan, 'shelf.delete', { shelfId }, [200, 404]);
      if (createdRepost) await action(fan, 'repost.set', { postId: post.id, active: false });
      const remaining = (await request(null, `comments?postId=${post.id}`)).data.comments;
      const remainingShelves = (await request(fan, `shelves?ownerId=${fan.userId}`)).data.shelves;
      check('Temporary comments and Shelves cleaned; preexisting content retained',
        !remaining.some((row) => row.content.startsWith(marker))
        && !remainingShelves.some((row) => ids.has(row.id))
        && (await request(null, 'bootstrap?view=feed')).data.posts.some((row) => row.id === post.id));
    } catch { process.exitCode = 1; console.error('Temporary interaction cleanup needs review. Marker:', marker); }
  }
  for (const context of contexts) {
    try { await clerkClient.sessions.revokeSession(context.sessionId); }
    catch { process.exitCode = 1; console.error('A newly created verification session could not be revoked.'); }
  }
  console.log('Completed real-account assertions:', passed);
}
