import { and, desc, eq, getTableColumns, inArray, lte, or, sql } from "drizzle-orm";
import { artistBoards, comments, db, mediaAssets, posts, profiles, shelfPosts, shelves } from "@workspace/db";
import { parseCommentCursor } from "./interactionValidation";
import { shelfSummaryFields } from "./interactionSql";

export const INTERACTION_PAGE_SIZE = 20;

export async function findPublicPost(id: string) {
  const [post] = await db.select({ id: posts.id, boardId: posts.boardId, authorId: posts.authorId }).from(posts)
    .innerJoin(profiles, eq(profiles.id, posts.authorId))
    .innerJoin(artistBoards, eq(artistBoards.id, posts.boardId))
    .where(and(eq(posts.id, id), eq(profiles.role, "Fan"))).limit(1);
  return post;
}

export async function readCommentPages(postIds: string[], token?: string, exactId?: string) {
  const pagination: Record<string, { pageSize: number; hasMore: boolean; nextCursor: string | null }> = {};
  for (const id of postIds) pagination[id] = { pageSize: INTERACTION_PAGE_SIZE, hasMore: false, nextCursor: null };
  const cursor = token && postIds.length === 1 ? parseCommentCursor(token, postIds[0]) : null;
  if (!postIds.length) return { comments: [], pagination };
  const ranked = db.select({
    ...getTableColumns(comments),
    authorUsername: profiles.username,
    authorRole: profiles.role,
    profileImageAssetId: sql<string | null>`coalesce(${profiles.profileImageAssetId},
      (select author_board.profile_image_asset_id from ${artistBoards} as author_board
        where author_board.owner_id = ${profiles.id} limit 1))`.as("author_image_id"),
    officialArtist: sql<boolean>`${profiles.role} = 'Artist' and ${profiles.id} = ${artistBoards.ownerId}`.as("official_artist"),
    cursorTime: sql<string>`to_char(${comments.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_time"),
    ordinal: sql<number>`row_number() over (partition by ${comments.postId} order by ${comments.createdAt} desc, ${comments.id} desc)`.as("ordinal"),
  }).from(comments).innerJoin(profiles, eq(profiles.id, comments.authorId))
    .innerJoin(posts, eq(posts.id, comments.postId))
    .innerJoin(artistBoards, eq(artistBoards.id, posts.boardId))
    .where(and(inArray(comments.postId, postIds), exactId ? eq(comments.id, exactId) : undefined, cursor
      ? sql`(${comments.createdAt}, ${comments.id}) < (${cursor.time}::timestamptz, ${cursor.id}::uuid)` : undefined))
    .as("ranked_comments");
  const rows = await db.select().from(ranked).where(lte(ranked.ordinal, INTERACTION_PAGE_SIZE + 1))
    .orderBy(desc(ranked.createdAt), desc(ranked.id));
  const presented = [];
  for (const postId of postIds) {
    const group = rows.filter((row) => row.postId === postId);
    const shown = group.slice(0, INTERACTION_PAGE_SIZE);
    const last = shown.at(-1);
    pagination[postId] = {
      pageSize: INTERACTION_PAGE_SIZE, hasMore: group.length > INTERACTION_PAGE_SIZE,
      nextCursor: group.length > INTERACTION_PAGE_SIZE && last
        ? Buffer.from(JSON.stringify({ postId, id: last.id, time: last.cursorTime })).toString("base64url") : null,
    };
    presented.push(...shown.map((row) => ({
      id: row.id, postId, authorId: row.authorId, authorUsername: row.authorUsername,
      authorRole: row.authorRole, officialArtist: row.officialArtist,
      profileImage: row.profileImageAssetId ? `/api/media/${encodeURIComponent(row.profileImageAssetId)}` : "",
      content: row.content, createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime() > row.createdAt.getTime() ? row.updatedAt.getTime() : null,
    })));
  }
  return { comments: presented, pagination };
}

export function shelfOwnerFilter(ownerId: string, viewerId: string | null) {
  return and(eq(shelves.ownerId, ownerId), ownerId === viewerId ? undefined : eq(shelves.visibility, "public"));
}

export async function readShelfPage(viewerId: string | null, ownerId: string | null, page: number,
  membershipPostIds: string[] = [], detailId?: string, detailIds?: string[]) {
  const empty = { shelves: [], pagination: { page, pageSize: INTERACTION_PAGE_SIZE, hasMore: false } };
  if (!ownerId && !detailId) return empty;
  const rows = await db.select({
    ...getTableColumns(shelves),
    ...shelfSummaryFields,
  }).from(shelves).where(detailId || detailIds?.length
    ? and(detailId ? eq(shelves.id, detailId) : inArray(shelves.id, detailIds!), viewerId
      ? or(eq(shelves.visibility, "public"), eq(shelves.ownerId, viewerId)) : eq(shelves.visibility, "public"))
    : shelfOwnerFilter(ownerId!, viewerId))
    .orderBy(desc(shelves.createdAt), desc(shelves.id)).limit(detailIds?.length ? Math.min(detailIds.length, 1000) : detailId ? 1 : INTERACTION_PAGE_SIZE + 1)
    .offset(detailId || detailIds?.length ? 0 : page * INTERACTION_PAGE_SIZE);
  const shown = rows.slice(0, detailIds?.length ? 1000 : INTERACTION_PAGE_SIZE);
  const ids = shown.map((row) => row.id);
  const [memberships, assets] = await Promise.all([
    ids.length && membershipPostIds.length ? db.select().from(shelfPosts)
      .where(and(inArray(shelfPosts.shelfId, ids), inArray(shelfPosts.postId, membershipPostIds)))
      : Promise.resolve([] as (typeof shelfPosts.$inferSelect)[]),
    db.select({ id: mediaAssets.id, contentType: mediaAssets.contentType }).from(mediaAssets)
      .where(and(eq(mediaAssets.status, "ready"), inArray(mediaAssets.id,
        shown.flatMap((row) => row.coverAssetId ? [row.coverAssetId] : [])))),
  ]);
  return {
    pagination: { page, pageSize: INTERACTION_PAGE_SIZE, hasMore: !detailId && !detailIds?.length && rows.length > INTERACTION_PAGE_SIZE },
    shelves: shown.map((shelf) => {
      const asset = assets.find((row) => row.id === shelf.coverAssetId);
      return { id: shelf.id, ownerId: shelf.ownerId, title: shelf.title,
        description: shelf.description, visibility: shelf.visibility, savedCount: shelf.savedCount,
        postIds: memberships.filter((saved) => saved.shelfId === shelf.id).map((saved) => saved.postId),
        cover: asset ? { url: `/api/media/${encodeURIComponent(asset.id)}`, type: asset.contentType.startsWith("video/") ? "video" : "image" } : null,
        createdAt: shelf.createdAt.getTime(), updatedAt: shelf.updatedAt.getTime() };
    }),
  };
}
