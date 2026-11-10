type Position = { id: string; time: string };
type SourceRow = { id: string; cursorTime: string };

// Consume one globally ordered window, not twenty items from each source.
// Undefined means "this source hasn't started"; null means exhausted.
export function combineFeedWindow<P extends SourceRow, R extends SourceRow>(
  posts: P[], reposts: R[], limit: number,
  previous: { posts?: Position | null; reposts?: Position | null } = {},
) {
  const candidates = [
    ...posts.map((row) => ({ kind: "post" as const, row })),
    ...reposts.map((row) => ({ kind: "repost" as const, row })),
  ].sort((a, b) => b.row.cursorTime.localeCompare(a.row.cursorTime)
    || b.kind.localeCompare(a.kind) || b.row.id.localeCompare(a.row.id)).slice(0, limit);
  const shownPosts = candidates.filter((entry) => entry.kind === "post").map((entry) => entry.row as P);
  const shownReposts = candidates.filter((entry) => entry.kind === "repost").map((entry) => entry.row as R);
  const next = <T extends SourceRow>(source: T[], shown: T[], prior: Position | null | undefined) => {
    if (source.length <= shown.length) return null;
    const last = shown.at(-1);
    return last ? { time: last.cursorTime, id: last.id } : prior;
  };
  const positions = { posts: next(posts, shownPosts, previous.posts), reposts: next(reposts, shownReposts, previous.reposts) };
  return { posts: shownPosts, reposts: shownReposts, positions,
    hasMore: positions.posts !== null || positions.reposts !== null };
}
