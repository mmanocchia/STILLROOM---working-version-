import assert from 'node:assert/strict';
import test from 'node:test';
import { appendPublicSnapshot } from '../src/publicContent.js';

// Pure unit fixtures, never inserted into PostgreSQL or displayed in the app.
const snapshot = (postIds, userId = null) => ({
  userId, profileId: userId,
  posts: postIds.map((id) => ({ id, boardId: `board-${id}`, authorId: `fan-${id}` })),
  boards: postIds.map((id) => ({ id: `board-${id}`, ownerId: `artist-${id}` })),
  accounts: postIds.flatMap((id) => [{ id: `fan-${id}` }, { id: `artist-${id}` }]),
  comments: [], reposts: [],
  discovery: { postIds, artistIds: [], boardIds: [] },
  pagination: { hasMore: false, nextCursor: null },
});

test('Load More appends ordered pages, replaces changed records and prevents duplicates', () => {
  const first = snapshot(['newest', 'older']);
  const second = snapshot(['older', 'oldest']);
  second.posts[0].content = 'Updated caption';
  const merged = appendPublicSnapshot(first, second);
  assert.deepEqual(merged.posts.map((post) => post.id), ['newest', 'older', 'oldest']);
  assert.equal(merged.posts[1].content, 'Updated caption');
  assert.deepEqual(appendPublicSnapshot(merged, second), merged);
});

test('public append cannot merge data across account identities', () => {
  assert.deepEqual(appendPublicSnapshot(snapshot(['old'], 'one'), snapshot(['new'], 'two')), snapshot(['new'], 'two'));
});

test('rolling windows retain older requested results and prune unrelated metadata', () => {
  const first = snapshot(['a', 'b', 'c']);
  first.comments = [{ id: 'comment', postId: 'a', authorId: 'fan-a' }];
  first.reposts = [{ id: 'repost', postId: 'a', userId: 'fan-a' }];
  const merged = appendPublicSnapshot(first, snapshot(['d', 'e']), 3);
  assert.deepEqual(merged.posts.map((post) => post.id), ['c', 'd', 'e']);
  assert.equal(merged.boards.length, 3);
  assert.equal(merged.accounts.length, 6);
  assert.deepEqual(merged.comments, []);
  assert.deepEqual(merged.reposts, []);
});

test('Explore retains Artists and empty Boards when the post source is exhausted', () => {
  const first = snapshot(['one']);
  first.discovery.artistIds = ['empty-artist'];
  first.discovery.boardIds = ['empty-board'];
  first.accounts.push({ id: 'empty-artist' });
  first.boards.push({ id: 'empty-board', ownerId: 'empty-artist' });
  const more = snapshot([]);
  more.discovery.artistIds = ['another-artist'];
  more.accounts.push({ id: 'another-artist' });
  const merged = appendPublicSnapshot(first, more);
  assert.deepEqual(merged.discovery.artistIds, ['empty-artist', 'another-artist']);
  assert.equal(merged.boards.some((board) => board.id === 'empty-board'), true);
  assert.equal(merged.posts[0].id, 'one');
});
