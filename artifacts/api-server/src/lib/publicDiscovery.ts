import { and, desc, eq, getTableColumns, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { artistBoards, db, follows, posts, profiles } from "@workspace/db";
import { PAGE_SIZE, type ContentPage } from "./contentPage";
import { discoveryScope, readDiscoveryCursor, writeDiscoveryCursor, keysetBoundary as boundary, cursorForWindow } from "./discoveryCursor";
import { categoryCondition, searchTerms, textMatch } from "./discoverySearch";

const owner = alias(profiles, "board_owner");
const profileDocument = (table: typeof profiles | typeof owner) =>
  sql`(${table.displayName} || ' ' || ${table.username} || ' ' || ${table.biography})`;
const boardDocument = sql`(${artistBoards.artistName} || ' ' || ${artistBoards.discipline} || ' ' || ${artistBoards.biography})`;
const timeText = (column: SQL) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export async function readPublicDiscovery(selection: ContentPage, userId: string | null) {
  const scope = discoveryScope(selection, userId);
  const cursor = readDiscoveryCursor(selection.cursor, scope);
  const clock = cursor ? null : await db.execute<{ snapshot: string }>(
    sql`select to_char(current_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as snapshot`);
  const snapshot = cursor?.snapshot || clock!.rows[0].snapshot;
  const terms = searchTerms(selection.q);
  const isExplore = selection.view === "explore";

  const readPosts = !cursor || cursor.posts !== null;
  const readArtists = isExplore && (!cursor || cursor.artists !== null);
  const readBoards = isExplore && (!cursor || cursor.boards !== null);
  const [postPage, artistPage, boardPage] = await Promise.all([
    readPosts ? db.select({ ...getTableColumns(posts), cursorTime: timeText(sql`${posts.publishedAt}`) })
      .from(posts)
      .innerJoin(profiles, eq(profiles.id, posts.authorId))
      .innerJoin(artistBoards, eq(artistBoards.id, posts.boardId))
      .innerJoin(owner, eq(owner.id, artistBoards.ownerId))
      .where(and(eq(profiles.role, "Fan"), eq(owner.role, "Artist"),
        boundary(sql`${posts.publishedAt}`, sql`${posts.id}`, snapshot, cursor?.posts),
        categoryCondition(sql`${artistBoards.discipline}`, selection.category),
        selection.followed ? userId
          ? inArray(artistBoards.ownerId, db.select({ id: follows.artistId }).from(follows).where(eq(follows.fanId, userId)))
          : sql`false` : undefined,
        ...terms.map((term) => or(textMatch(sql`${posts.content}`, term),
          textMatch(boardDocument, term), textMatch(profileDocument(profiles), term),
          textMatch(profileDocument(owner), term)))))
      .orderBy(desc(posts.publishedAt), desc(posts.id)).limit(PAGE_SIZE + 1)
      : Promise.resolve([] as (typeof posts.$inferSelect & { cursorTime: string })[]),
    readArtists ? db.select({ ...getTableColumns(profiles), cursorTime: timeText(sql`${profiles.createdAt}`) })
      .from(profiles).leftJoin(artistBoards, eq(artistBoards.ownerId, profiles.id))
      .where(and(eq(profiles.role, "Artist"),
        boundary(sql`${profiles.createdAt}`, sql`${profiles.id}`, snapshot, cursor?.artists),
        selection.category ? categoryCondition(sql`coalesce(${artistBoards.discipline}, '')`, selection.category) : undefined,
        selection.category ? sql`${artistBoards.id} is not null` : undefined,
        ...terms.map((term) => or(textMatch(profileDocument(profiles), term),
          textMatch(sql`coalesce(${boardDocument}, '')`, term)))))
      .orderBy(desc(profiles.createdAt), desc(profiles.id)).limit(PAGE_SIZE + 1)
      : Promise.resolve([] as (typeof profiles.$inferSelect & { cursorTime: string })[]),
    readBoards ? db.select({ ...getTableColumns(artistBoards), cursorTime: timeText(sql`${artistBoards.createdAt}`) })
      .from(artistBoards).innerJoin(profiles, eq(profiles.id, artistBoards.ownerId))
      .where(and(eq(profiles.role, "Artist"),
        boundary(sql`${artistBoards.createdAt}`, sql`${artistBoards.id}`, snapshot, cursor?.boards),
        categoryCondition(sql`${artistBoards.discipline}`, selection.category),
        ...terms.map((term) => or(textMatch(boardDocument, term), textMatch(profileDocument(profiles), term)))))
      .orderBy(desc(artistBoards.createdAt), desc(artistBoards.id)).limit(PAGE_SIZE + 1)
      : Promise.resolve([] as (typeof artistBoards.$inferSelect & { cursorTime: string })[]),
  ]);
  const postRows = postPage.slice(0, PAGE_SIZE);
  const artistRows = artistPage.slice(0, PAGE_SIZE);
  const boardRows = boardPage.slice(0, PAGE_SIZE);
  const relatedBoards = await db.select().from(artistBoards).where(or(
    inArray(artistBoards.id, postRows.map((post) => post.boardId)),
    inArray(artistBoards.ownerId, [...artistRows.map((artist) => artist.id), ...(userId ? [userId] : [])]),
  ));
  const allBoards = [...new Map([...boardRows, ...relatedBoards].map((board) => [board.id, board])).values()];
  const relatedProfiles = await db.select().from(profiles).where(inArray(profiles.id, [
    ...postRows.map((post) => post.authorId), ...allBoards.map((board) => board.ownerId), ...(userId ? [userId] : []),
  ]));
  const allProfiles = [...new Map([...artistRows, ...relatedProfiles].map((profile) => [profile.id, profile])).values()];
  const next = {
    version: 1 as const, scope, snapshot,
    posts: cursorForWindow(postPage, PAGE_SIZE),
    artists: isExplore ? cursorForWindow(artistPage, PAGE_SIZE) : null,
    boards: isExplore ? cursorForWindow(boardPage, PAGE_SIZE) : null,
  };
  const hasMore = Boolean(next.posts || next.artists || next.boards);
  return {
    posts: postRows,
    profiles: allProfiles,
    boards: allBoards,
    pagination: { page: 0, pageSize: PAGE_SIZE, hasMore, nextCursor: hasMore ? writeDiscoveryCursor(next) : null },
    discovery: {
      artistIds: artistRows.map((artist) => artist.id),
      boardIds: boardRows.map((board) => board.id),
      postIds: postRows.map((post) => post.id),
    },
  };
}
