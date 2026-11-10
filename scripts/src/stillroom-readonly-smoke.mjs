// No cookies, tokens, database writes, fixtures, account creation or deletion.
// Rejection probes are opt-in and explicitly forbidden against a published URL.
// Usage: node scripts/src/stillroom-readonly-smoke.mjs [https://base] [--rejection-probes]
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

const base = process.argv.find((arg) => /^https?:\/\//.test(arg))
  || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const probes = process.argv.includes('--rejection-probes');
if (probes && !new URL(base).hostname.endsWith('.replit.dev')) {
  throw new Error('Rejection probes are development-only.');
}
let passed = 0;
let failed = 0;
async function check(name, path, expected = 200, options = {}, verify = () => {}) {
  const started = performance.now();
  try {
    const response = await fetch(new URL(path, base), {
      redirect: 'manual', signal: AbortSignal.timeout(20000), ...options,
    });
    assert.equal(response.status, expected, `expected ${expected}, got ${response.status}`);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    const data = await response.json();
    verify(data, response);
    passed++;
    console.log(`PASS ${name}: ${response.status} (${Math.round(performance.now() - started)} ms)`);
    return data;
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}: ${error.message}`);
    return null;
  }
}
const guest = (data) => {
  assert.equal(data.userId, null);
  assert.equal(data.profileId, null);
  assert.deepEqual(data.followedArtistsByFan, {});
  assert.deepEqual(data.postDrafts, {});
  for (const account of data.accounts) {
    assert.equal('email' in account, false);
    assert.equal('password' in account, false);
  }
};
await check('Health', '/api/healthz');
await check('Guest identity', '/api/auth/user', 200, {}, (data) => {
  assert.equal(data.userId, null); assert.equal(data.profile, null);
});
const feed = await check('Public paginated Feed and private-state isolation',
  '/api/social/bootstrap?view=feed', 200, {}, (data, response) => {
    guest(data);
    assert.ok(data.posts.length <= 20);
    assert.equal(data.pagination.pageSize, 20);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
  });
await check('Explore', '/api/social/bootstrap?view=explore', 200, {}, guest);
for (const category of ['Music', 'Film', 'Photography', 'Painting', 'Fashion', 'Other']) {
  await check(`Category ${category}`, `/api/social/bootstrap?view=explore&category=${category}`);
}
await check('Combined search/filter no-results', '/api/social/bootstrap?view=explore&category=Music&q=stillroom-readiness-no-match-839c8a', 200, {}, (data) => {
  assert.deepEqual(data.boards, []); assert.deepEqual(data.posts, []);
});
await check('Invalid cursor', '/api/social/bootstrap?view=feed&cursor=invalid', 400);
await check('Invalid category', '/api/social/bootstrap?view=explore&category=Invalid', 400);
await check('Guest Settings denied', '/api/account/settings', 401);
await check('Guest personal Shelves denied', '/api/social/shelves', 401);
await check('Missing media handled', '/api/media/00000000-0000-4000-8000-000000000000', 404);
await check('Missing board handled', '/api/social/boards/00000000-0000-4000-8000-000000000000/curation', 404);
const board = feed?.boards?.[0];
const post = feed?.posts?.[0];
if (board) {
  await check('Existing public Artist Board', `/api/social/bootstrap?boardId=${encodeURIComponent(board.id)}`);
  await check('Public Featured/Collections', `/api/social/boards/${encodeURIComponent(board.id)}/curation`);
  await check('Public Artist profile', `/api/social/bootstrap?profileId=${encodeURIComponent(board.ownerId)}`);
  await check('Public profile Shelves', `/api/social/shelves?ownerId=${encodeURIComponent(board.ownerId)}`);
}
if (post) {
  await check('Existing public post comments', `/api/social/comments?postId=${encodeURIComponent(post.id)}`);
  await check('Public Fan profile', `/api/social/bootstrap?profileId=${encodeURIComponent(post.authorId)}`);
}
if (probes) {
  const json = { 'Content-Type': 'application/json' };
  await check('Malformed JSON safely rejected', '/api/social/actions', 400, {
    method: 'POST', headers: json, body: '{',
  });
  await check('Compressed JSON rejected before decompression', '/api/social/actions', 415, {
    method: 'POST', headers: { ...json, 'Content-Encoding': 'gzip' }, body: gzipSync('{}'),
  });
  await check('Oversized JSON safely rejected', '/api/social/actions', 413, {
    method: 'POST', headers: json, body: JSON.stringify({ value: 'x'.repeat(103000) }),
  });
  await check('Cross-site mutation denied', '/api/social/actions', 403, {
    method: 'POST', headers: { ...json, Origin: 'https://not-stillroom.invalid' }, body: '{}',
  });
  for (const path of ['/auth/profile', '/storage/uploads/request-url', '/storage/uploads/complete']) {
    await check(`Guest denied ${path}`, `/api${path}`, 401, { method: 'POST', headers: json, body: '{}' });
  }
  await check('Guest content deletion denied', '/api/social/actions', 401, {
    method: 'POST', headers: json, body: JSON.stringify({
      action: 'post.delete', payload: { postId: '00000000-0000-4000-8000-000000000000' },
    }),
  });
  await check('Guest account deletion denied', '/api/account/deletion', 401, {
    method: 'POST', headers: json, body: JSON.stringify({
      receipt: '0'.repeat(64), confirmation: 'DELETE', artistCascadeConfirmed: true,
    }),
  });
  await check('Guest curation denied', `/api/social/boards/${board?.id || '00000000-0000-4000-8000-000000000000'}/curation`, 401, {
    method: 'POST', headers: json, body: JSON.stringify({
      action: 'feature.set', payload: { postId: '00000000-0000-4000-8000-000000000000', active: false },
    }),
  });
}
console.log(JSON.stringify({ base: new URL(base).origin, passed, failed, authenticatedTests: 'NOT RUN', recordWrites: 'NONE' }));
process.exitCode = failed ? 1 : 0;
