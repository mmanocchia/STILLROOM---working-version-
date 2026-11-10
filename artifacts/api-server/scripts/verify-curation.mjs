// Opt-in development audit: only temporary curation relationships/Collections.
// No users, Boards, original posts, media, comments, or Shelves are created/deleted.
import { clerkClient } from '@clerk/express';
import { randomUUID } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

if (!process.argv.includes('--allow-temporary-curation')) throw new Error('Explicit permission required: --allow-temporary-curation');
if (!process.env.REPLIT_DEV_DOMAIN?.endsWith('.replit.dev')) throw new Error('Development environment required.');
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const marker = `Curation verification ${randomUUID().slice(0, 8)}`;
const contexts = [], createdCollections = [];
let artist, fan, board, original, createdFeature = false, passed = 0, cleaned = true;
const check = (label, result) => {
  console.log(result ? 'PASS' : 'FAIL', label);
  if (!result) throw new Error(label);
  passed++;
};
async function request(context, path, body, expected = [200]) {
  const headers = { Origin: origin };
  if (context) {
    if (!context.jwt || Date.now() > context.refreshAt) {
      context.jwt = (await clerkClient.sessions.getToken(context.id)).jwt;
      context.refreshAt = Date.now() + 40000;
    }
    headers.Authorization = `Bearer ${context.jwt}`;
  }
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + '/api/social/' + path, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!expected.includes(response.status)) throw new Error(`Unexpected HTTP ${response.status} for ${path.split('?')[0]}`);
  return response.json();
}
const read = (actor, query = '') => request(actor, `boards/${board.id}/curation${query}`);
const command = (actor, action, payload, expected) => request(actor, `boards/${board.id}/curation`, { action, payload }, expected);
async function session(profile) {
  const user = await clerkClient.users.getUser(profile.id);
  check(`Existing ${profile.role} identity verified`, user.id === profile.id);
  const created = await clerkClient.sessions.createSession({ userId: user.id });
  const context = { id: created.id, userId: user.id };
  contexts.push(context);
  const bootstrap = await request(context, 'bootstrap?view=feed');
  check(`Signed ${profile.role} session restores its exact PostgreSQL profile`, bootstrap.profileId === user.id
    && bootstrap.accounts.some((row) => row.id === user.id && row.role === profile.role));
  return context;
}
try {
  const initial = await request(null, 'bootstrap?view=feed');
  original = initial.posts[0];
  board = initial.boards.find((row) => row.id === original?.boardId);
  const fanProfile = initial.accounts.find((row) => row.id === original?.authorId && row.role === 'Fan');
  const artistProfile = initial.accounts.find((row) => row.id === board?.ownerId && row.role === 'Artist');
  if (!original || !board || !fanProfile || !artistProfile) throw new Error('Existing Fan post and owning Artist required.');
  fan = await session(fanProfile);
  artist = await session(artistProfile);
  const base = await read(null);
  const actions = [
    ['feature.set', { postId: original.id, active: true }],
    ['feature.move', { postId: original.id, direction: 'up' }],
    ['collection.save', { collectionId: null, title: marker, description: '' }],
    ['collection.delete', { collectionId: randomUUID() }],
    ['collection.move', { collectionId: randomUUID(), direction: 'up' }],
    ['collection.post', { collectionId: randomUUID(), postId: original.id, active: true }],
  ];
  for (const [name, payload] of actions) {
    await command(null, name, payload, [401]);
    await command(fan, name, payload, [403]);
  }
  check('All six management actions reject visitors and Fans', true);
  await request(artist, `boards/${randomUUID()}/curation`, { action: 'feature.set', payload: { postId: original.id, active: true } }, [403]);
  await command(artist, 'feature.set', { postId: randomUUID(), active: true }, [404]);
  await command(artist, 'feature.set', { postId: original.id, active: true, ownerId: fan.userId }, [400]);
  check('Other Board, unavailable post and spoofed ownership requests rejected', true);
  if (!base.featuredPostIds.includes(original.id)) {
    if (base.featuredPostIds.length >= 5) throw new Error('Board already full: existing curation will not be modified.');
    createdFeature = true;
    await command(artist, 'feature.set', { postId: original.id, active: true });
    await command(artist, 'feature.set', { postId: original.id, active: true });
    const featured = await read(null);
    check('Artist feature persists publicly without duplicate originals', featured.featuredPostIds.filter((id) => id === original.id).length === 1
      && featured.snapshot.posts.filter((row) => row.id === original.id).length === 1);
    // Only exercise boundary ordering when no existing featured order can change.
    if (base.featuredPostIds.length === 0) {
      await command(artist, 'feature.move', { postId: original.id, direction: 'up' });
      await command(artist, 'feature.move', { postId: original.id, direction: 'down' });
      check('Single featured post safely handles both reorder boundaries', (await read(null)).featuredPostIds[0] === original.id);
    }
  }
  for (let i = 0; i < 2; i++) {
    const title = `${marker} ${i}`;
    await command(artist, 'collection.save', { collectionId: null, title, description: 'Temporary development verification' });
    // Scan pages to find this exact unique marker even on an existing busy Board.
    let found;
    for (let page = 0; page < 50000 && !found; page++) {
      const data = await read(artist, `?collectionPage=${page}`);
      found = data.collections.find((row) => row.title === title);
      if (!data.collectionPagination.hasMore) break;
    }
    if (!found) throw new Error('Created Collection missing from read.');
    createdCollections.push(found.id);
    await command(artist, 'collection.post', { collectionId: found.id, postId: original.id, active: true });
    await command(artist, 'collection.post', { collectionId: found.id, postId: original.id, active: true });
    const detail = await read(null, `?collectionId=${found.id}`);
    check('Collection publicly references the existing post exactly once', detail.selectedCollection.postCount === 1
      && detail.collectionPostIds.length === 1 && detail.collectionPostIds[0] === original.id);
    const post = detail.snapshot.posts.find((row) => row.id === original.id);
    check('Original author, caption, media and publication date unchanged', post.authorId === original.authorId
      && post.authorUsername === original.authorUsername && post.content === original.content
      && JSON.stringify(post.media) === JSON.stringify(original.media) && post.publishedAt === original.publishedAt);
  }
  const [a, b] = createdCollections;
  const beforeA = (await read(artist, `?collectionId=${a}`)).selectedCollection.position;
  const beforeB = (await read(artist, `?collectionId=${b}`)).selectedCollection.position;
  await command(artist, 'collection.move', { collectionId: b, direction: 'up' });
  check('Artist can reorder its new Collections', (await read(null, `?collectionId=${b}`)).selectedCollection.position === beforeA
    && (await read(null, `?collectionId=${a}`)).selectedCollection.position === beforeB);
  await command(artist, 'collection.move', { collectionId: b, direction: 'down' });
  await command(artist, 'collection.save', { collectionId: a, title: `${marker} renamed`, description: 'Updated' });
  check('Collection edits persist for a different authenticated account', (await read(fan, `?collectionId=${a}`)).selectedCollection.title === `${marker} renamed`);
  await command(artist, 'collection.save', { collectionId: a, title: ' ', description: '' }, [400]);
  await command(artist, 'collection.post', { collectionId: randomUUID(), postId: original.id, active: true }, [404]);
  await command(artist, 'collection.post', { collectionId: a, postId: randomUUID(), active: true }, [404]);
  check('Empty title and unrelated/unavailable Collection/post references rejected', true);
  await command(artist, 'collection.post', { collectionId: a, postId: original.id, active: false });
  check('Removing one membership preserves another Collection and original post',
    (await read(null, `?collectionId=${a}`)).selectedCollection.postCount === 0
    && (await read(null, `?collectionId=${b}`)).selectedCollection.postCount === 1
    && (await request(fan, `bootstrap?postId=${original.id}`)).posts[0].id === original.id);
  await command(artist, 'collection.post', { collectionId: a, postId: original.id, active: true });
  const nextPage = await read(null, `?collectionId=${a}&page=1`);
  check('Collection pagination returns bounded pages and accurate exhaustion', nextPage.collectionPostIds.length === 0
    && nextPage.postPagination.page === 1 && !nextPage.postPagination.hasMore);
  const artistAgain = await session(artistProfile);
  check('Curation survives an independent real login session and reload',
    (await read(artistAgain, `?collectionId=${a}`)).collectionPostIds.includes(original.id));
  await request(artist, 'actions', { action: 'post.save', payload: { boardId: board.id, content: '', mediaAssetId: null } }, [403]);
  check('Artist still cannot publish an original Fan post', true);
  for (const path of ['bootstrap?view=feed', 'bootstrap?view=explore', `comments?postId=${original.id}`, `bootstrap?profileId=${fan.userId}`, `shelves?ownerId=${fan.userId}`]) await request(fan, path);
  check('Feed, Explore, Comments, public Profiles and Shelves reads remain successful', true);
  if (process.argv.includes('--hold-for-browser')) {
    await writeFile('/tmp/stillroom-curation-browser-ready.json', JSON.stringify({ boardId: board.id, collectionId: a, postId: original.id }));
    console.log('Browser verification records ready; waiting up to ten minutes.');
    for (let i = 0; i < 300; i++) {
      if (await access('/tmp/stillroom-curation-browser-done').then(() => true).catch(() => false)) break;
      await delay(2000);
    }
  }
} finally {
  if (artist && board) {
    // Marker-scoped fallback catches a successful create with a lost HTTP response.
    try {
      for (let page = 0; page < 50000; page++) {
        const data = await read(artist, `?collectionPage=${page}`);
        for (const row of data.collections) if (row.title.startsWith(marker) && !createdCollections.includes(row.id)) createdCollections.push(row.id);
        if (!data.collectionPagination.hasMore) break;
      }
      for (const collectionId of createdCollections) await command(artist, 'collection.delete', { collectionId });
      if (createdFeature) await command(artist, 'feature.set', { postId: original.id, active: false });
      check('Only temporary curation removed; original remains intact', !(await read(null)).collections.some((row) => row.title.startsWith(marker))
        && (await request(null, `bootstrap?postId=${original.id}`)).posts.some((row) => row.id === original.id));
    } catch (error) { cleaned = false; console.error('Cleanup could not be confirmed:', error.message); }
  }
  for (const context of contexts) {
    try { await clerkClient.sessions.revokeSession(context.id); }
    catch { cleaned = false; console.error('An audit-created session could not be revoked.'); }
  }
  if (!cleaned) process.exitCode = 1;
  console.log(`${passed} assertions passed. Temporary curation cleanup ${cleaned ? 'complete' : 'requires attention'}.`);
}
