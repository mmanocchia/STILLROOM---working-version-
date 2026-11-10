export const PUBLIC_WINDOW_LIMIT = 100;
const mergeRows = (left = [], right = []) => [...new Map([...left, ...right].map((row) => [row.id, row])).values()];
const mergeIds = (left = [], right = [], limit = PUBLIC_WINDOW_LIMIT) => [...new Set([...left, ...right])].slice(-limit);

// Append only within the same authenticated identity. Retain a rolling, bounded
// window and the related metadata it needs, not the entire public catalogue.
export function appendPublicSnapshot(previous, incoming, limit = PUBLIC_WINDOW_LIMIT) {
  if (previous.userId !== incoming.userId || previous.profileId !== incoming.profileId) return incoming;
  const posts = mergeRows(previous.posts, incoming.posts).slice(-limit);
  const postIds = new Set(posts.map((post) => post.id));
  const discovery = {
    artistIds: mergeIds(previous.discovery?.artistIds, incoming.discovery?.artistIds, limit),
    boardIds: mergeIds(previous.discovery?.boardIds, incoming.discovery?.boardIds, limit),
    postIds: mergeIds(previous.discovery?.postIds, incoming.discovery?.postIds, limit).filter((id) => postIds.has(id)),
    repostIds: mergeIds(previous.discovery?.repostIds, incoming.discovery?.repostIds, limit),
  };
  const comments = mergeRows(previous.comments, incoming.comments).filter((comment) => postIds.has(comment.postId));
  const reposts = mergeRows(previous.reposts, incoming.reposts).filter((repost) => postIds.has(repost.postId));
  const boardIds = new Set([...discovery.boardIds, ...posts.map((post) => post.boardId)]);
  const artistIds = new Set([...discovery.artistIds, incoming.profileId]);
  const boards = mergeRows(previous.boards, incoming.boards)
    .filter((board) => boardIds.has(board.id) || artistIds.has(board.ownerId));
  const accountIds = new Set([...artistIds, ...boards.map((board) => board.ownerId),
    ...posts.map((post) => post.authorId), ...comments.map((comment) => comment.authorId), ...reposts.map((repost) => repost.userId)]);
  const accounts = mergeRows(previous.accounts, incoming.accounts).filter((account) => accountIds.has(account.id));
  return { ...incoming, posts, boards, accounts, comments, reposts, discovery };
}

export function patchInteraction(previous, incoming, action, payload = {}) {
  if (previous.userId !== incoming.userId || previous.profileId !== incoming.profileId) return incoming;
  const id = incoming.interactionPostId;
  const available = incoming.posts.some((post) => post.id === id);
  const posts = mergeRows(previous.posts, incoming.posts).filter((post) => post.id !== id || available);
  const ownOldRepostIds = new Set(previous.reposts.filter((row) => row.postId === id && row.userId === incoming.profileId).map((row) => row.id));
  const reposts = mergeRows(previous.reposts.filter((row) => !(row.postId === id && row.userId === incoming.profileId)), incoming.reposts)
    .filter((row) => row.postId !== id || available);
  let comments = mergeRows(previous.comments, incoming.comments);
  if (incoming.commentResult) comments = mergeRows(comments, [incoming.commentResult]);
  comments = comments.filter((comment) => comment.id !== incoming.deletedCommentId && (comment.postId !== id || available));
  if (action === 'comment.save' && !payload.commentId) {
    comments = [...comments.filter((comment) => comment.postId !== id), ...incoming.comments];
  }
  const boundedComments = comments.filter((comment) => comment.postId === id)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, 100);
  comments = [...comments.filter((comment) => comment.postId !== id), ...boundedComments];
  const discovery = previous.discovery ? { ...previous.discovery,
    postIds: previous.discovery.postIds.filter((postId) => postId !== id || available),
    repostIds: [...new Set([...(previous.discovery.repostIds || []).filter((repostId) => (available && !action.startsWith('repost.')) || !ownOldRepostIds.has(repostId)),
      ...reposts.filter((row) => row.userId === incoming.profileId && row.postId === id && action.startsWith('repost.')).map((row) => row.id)])],
  } : null;
  return { ...incoming, posts, reposts, comments, discovery,
    accounts: mergeRows(previous.accounts, incoming.accounts),
    boards: mergeRows(previous.boards, incoming.boards),
    shelves: mergeRows(previous.shelves, incoming.shelves),
    pagination: previous.pagination, shelfPagination: previous.shelfPagination,
    commentPagination: { ...previous.commentPagination, ...incoming.commentPagination },
  };
}
