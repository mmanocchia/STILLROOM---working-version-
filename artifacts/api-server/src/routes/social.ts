import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, inArray, notInArray, or, ilike, not, sql } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { changeUsernameSchema } from "../lib/profileValidation";
import { contentPageSchema, PAGE_SIZE, pageWindow, type ContentPage } from "../lib/contentPage";
import { readPublicDiscovery } from "../lib/publicDiscovery";
import { discoveryScope, readDiscoveryCursor, DiscoveryCursorError } from "../lib/discoveryCursor";
import { findPublicPost, readCommentPages, readShelfPage } from "../lib/interactionData";
import { canComment, commentInput, repostInput, shelfSelectionInput, InteractionCursorError, parseCommentCursor } from "../lib/interactionValidation";
import {
  artistBoards,
  comments,
  db,
  follows,
  mediaAssets,
  posts,
  postDrafts as savedPostDrafts,
  profiles,
  reposts,
  shelfPosts,
  shelves,
} from "@workspace/db";

const router: IRouter = Router();

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const commandSchema = z.object({
  action: z.string().min(1).max(40),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const optionalText = (max: number) => z.string().trim().max(max).optional();

function currentUserId(req: Request): string | null {
  return getAuth(req).userId ?? null;
}

function mediaUrl(id: string | null | undefined): string {
  return id ? `/api/media/${encodeURIComponent(id)}` : "";
}

async function currentProfile(userId: string) {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return profile;
}

async function requireProfile(userId: string | null, role?: "Fan" | "Artist") {
  if (!userId) throw new HttpError(401, "Sign in to continue.");
  const profile = await currentProfile(userId);
  if (!profile) throw new HttpError(403, "Finish setting up your Stillroom profile first.");
  if (role && profile.role !== role) throw new HttpError(403, `Only ${role} accounts can do that.`);
  return profile;
}

async function requireOwnedMedia(assetId: string | null, ownerId: string, imageOnly = false) {
  if (!assetId) return null;
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerId, ownerId), eq(mediaAssets.status, "ready")))
    .limit(1);
  if (!asset) throw new HttpError(400, "That upload is unavailable.");
  if (imageOnly && !["image/jpeg", "image/png", "image/webp"].includes(asset.contentType)) {
    throw new HttpError(400, "Choose a PNG, JPG, or WebP profile image.");
  }
  return asset;
}

async function getBootstrap(userId: string | null, selection: ContentPage = contentPageSchema.parse({}), extraShelfIds: string[] = []) {
  const publicPage = selection.view ? await readPublicDiscovery(selection, userId) : null;
  const conditions = [];
  if (selection.shelfList) conditions.push(sql`false`);
  if (selection.mine) conditions.push(userId
    ? or(eq(posts.authorId, userId), inArray(posts.boardId,
      db.select({ id: artistBoards.id }).from(artistBoards).where(eq(artistBoards.ownerId, userId))))
    : sql`false`);
  if (selection.boardId) conditions.push(eq(posts.boardId, selection.boardId));
  if (selection.authorId) conditions.push(eq(posts.authorId, selection.authorId));
  if (selection.profileId) conditions.push(or(eq(posts.authorId, selection.profileId),
    inArray(posts.boardId, db.select({ id: artistBoards.id }).from(artistBoards)
      .where(eq(artistBoards.ownerId, selection.profileId)))));
  if (selection.postId) conditions.push(eq(posts.id, selection.postId));
  if (selection.repostsBy) conditions.push(inArray(posts.id,
    db.select({ id: reposts.postId }).from(reposts).where(eq(reposts.userId, selection.repostsBy))));
  if (selection.shelfId) conditions.push(inArray(posts.id,
    db.select({ id: shelfPosts.postId }).from(shelfPosts)
      .innerJoin(shelves, eq(shelves.id, shelfPosts.shelfId))
      .where(and(eq(shelves.id, selection.shelfId), userId
        ? or(eq(shelves.visibility, "public"), eq(shelves.ownerId, userId))
        : eq(shelves.visibility, "public")))));
  if (selection.followed) conditions.push(userId
    ? inArray(posts.boardId, db.select({ id: artistBoards.id }).from(artistBoards)
      .innerJoin(follows, eq(follows.artistId, artistBoards.ownerId)).where(eq(follows.fanId, userId)))
    : sql`false`);
  if (selection.category) {
    const categories = ["Music", "Film", "Photography", "Painting", "Fashion"];
    conditions.push(inArray(posts.boardId, db.select({ id: artistBoards.id }).from(artistBoards)
      .where(selection.category === "Other"
        ? and(...categories.map((category) => not(ilike(artistBoards.discipline, `%${category}%`))))
        : ilike(artistBoards.discipline, `%${selection.category}%`))));
  }
  // Each search word must match a caption, its author, or its Artist Board.
  for (const word of (selection.q || "").split(/\s+/).filter(Boolean)) {
    const pattern = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(posts.content, pattern),
      inArray(posts.authorId, db.select({ id: profiles.id }).from(profiles)
        .where(or(ilike(profiles.username, pattern), ilike(profiles.displayName, pattern)))),
      inArray(posts.boardId, db.select({ id: artistBoards.id }).from(artistBoards)
        .innerJoin(profiles, eq(profiles.id, artistBoards.ownerId))
        .where(or(ilike(artistBoards.artistName, pattern), ilike(artistBoards.biography, pattern),
          ilike(artistBoards.discipline, pattern), ilike(profiles.username, pattern),
          ilike(profiles.displayName, pattern))))));
  }
  const page = publicPage ? { rows: publicPage.posts, pagination: publicPage.pagination } : pageWindow(await db.select().from(posts).where(and(...conditions))
    .orderBy(selection.repostsBy ? desc(sql`(select max(${reposts.repostedAt}) from ${reposts}
      where ${reposts.postId} = ${posts.id} and ${reposts.userId} = ${selection.repostsBy})`) : desc(posts.publishedAt), desc(posts.id))
    .limit(PAGE_SIZE + 1).offset(selection.page * PAGE_SIZE), selection.page);
  const postRows = page.rows;
  const postIds = postRows.map((post) => post.id);
  const [boardRows, repostRows, commentData, shelfData] =
    await Promise.all([
      publicPage ? publicPage.boards : db.select().from(artistBoards).where(or(
        inArray(artistBoards.id, [...postRows.map((post) => post.boardId), ...(selection.boardId ? [selection.boardId] : [])]),
        inArray(artistBoards.ownerId, [userId, selection.profileId].filter((id): id is string => Boolean(id))),
        selection.artistList && userId ? inArray(artistBoards.ownerId,
          db.select({ id: follows.artistId }).from(follows).where(eq(follows.fanId, userId))) : undefined,
      )),
      postIds.length && (userId || selection.repostsBy || selection.profileId)
        ? db.select().from(reposts).where(and(inArray(reposts.postId, postIds),
          inArray(reposts.userId, [userId, selection.repostsBy, selection.profileId].filter((id): id is string => Boolean(id)))))
        : Promise.resolve([] as (typeof reposts.$inferSelect)[]),
      readCommentPages(postIds),
      readShelfPage(userId, selection.profileId || selection.repostsBy || userId, selection.shelfPage,
        postIds, selection.shelfId, extraShelfIds.length ? extraShelfIds : undefined),
    ]);
  if (selection.shelfId && !shelfData.shelves.length) throw new HttpError(404, "Shelf not found.");
  const eventReposts = publicPage?.reposts || [];
  const presentedReposts = [...new Map([...repostRows, ...eventReposts].map((row) => [row.id, row])).values()];
  const neededProfiles = [...new Set([...boardRows.map((board) => board.ownerId),
    ...postRows.map((post) => post.authorId), ...presentedReposts.map((repost) => repost.userId),
    ...[userId, selection.profileId, selection.repostsBy].filter((id): id is string => Boolean(id))])];
  const extraProfiles = await db.select().from(profiles).where(inArray(profiles.id, neededProfiles));
  const profileRows = [...new Map([...(publicPage?.profiles || []), ...extraProfiles].map((row) => [row.id, row])).values()];

  const assetIds = [...new Set([
    ...profileRows.map((row) => row.profileImageAssetId),
    ...boardRows.map((row) => row.profileImageAssetId),
    ...postRows.map((row) => row.mediaAssetId),
  ].filter((id): id is string => Boolean(id)))];
  const mediaRows = await db.select().from(mediaAssets).where(and(eq(mediaAssets.status, "ready"),
    userId ? or(inArray(mediaAssets.id, assetIds), inArray(mediaAssets.id,
      db.select({ id: savedPostDrafts.mediaAssetId }).from(savedPostDrafts).where(eq(savedPostDrafts.authorId, userId))))
      : inArray(mediaAssets.id, assetIds)));

  const accountById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const mediaById = new Map(mediaRows.map((asset) => [asset.id, asset]));
  const boardById = new Map(boardRows.map((board) => [board.id, board]));
  const postById = new Map(postRows.map((post) => [post.id, post]));
  const followed = userId
    ? await db.select().from(follows).where(eq(follows.fanId, userId))
    : [];
  const draftRows = userId
    ? await db.select().from(savedPostDrafts).where(eq(savedPostDrafts.authorId, userId))
    : [];

  const presentedProfiles = profileRows.map((profile) => ({
    id: profile.id,
    role: profile.role,
    name: profile.displayName,
    username: profile.username,
    biography: profile.biography,
    interests: profile.interests,
    profileImageAssetId: profile.profileImageAssetId,
    profileImage: mediaById.has(profile.profileImageAssetId || "")
      ? mediaUrl(profile.profileImageAssetId)
      : "",
    createdAt: profile.createdAt.getTime(),
  }));
  const presentedBoards = boardRows.map((board) => ({
    id: board.id,
    ownerId: board.ownerId,
    artistName: board.artistName,
    discipline: board.discipline,
    biography: board.biography,
    profileImage: mediaById.has(board.profileImageAssetId || "")
      ? mediaUrl(board.profileImageAssetId)
      : "",
    profileImageAssetId: board.profileImageAssetId,
    createdAt: board.createdAt.getTime(),
    updatedAt: board.updatedAt.getTime(),
  }));
  const presentedPosts = postRows.map((post) => {
    const asset = post.mediaAssetId ? mediaById.get(post.mediaAssetId) : null;
    return {
      id: post.id,
      boardId: post.boardId,
      authorId: post.authorId,
      authorUsername: accountById.get(post.authorId)?.username || "",
      content: post.content,
      media: asset
        ? { assetId: asset.id, url: mediaUrl(asset.id), name: asset.name, type: asset.contentType.startsWith("video/") ? "video" : "image", contentType: asset.contentType, size: asset.size }
        : null,
      publishedAt: post.publishedAt.getTime(),
      updatedAt: post.updatedAt.getTime(),
    };
  }).filter((post) => boardById.has(post.boardId) && accountById.has(post.authorId));
  const presentedComments = commentData.comments;
  const presentedShelves = shelfData.shelves;

  return {
    pagination: page.pagination,
    commentPagination: commentData.pagination,
    shelfPagination: shelfData.pagination,
    ...(publicPage ? { discovery: publicPage.discovery } : {}),
    userId,
    profileId: userId && accountById.has(userId) ? userId : null,
    accounts: presentedProfiles,
    boards: presentedBoards,
    posts: presentedPosts,
    comments: presentedComments,
    reposts: presentedReposts
      .filter((repost) => accountById.has(repost.userId) && postById.has(repost.postId))
      .map((repost) => ({
        id: repost.id,
        userId: repost.userId,
        postId: repost.postId,
        repostedAt: repost.repostedAt.getTime(),
      })),
    followedArtistsByFan: userId
      ? { [userId]: followed.map((entry) => entry.artistId) }
      : {},
    shelves: presentedShelves,
    postDrafts: Object.fromEntries(draftRows.map((draft) => {
      const asset = draft.mediaAssetId ? mediaById.get(draft.mediaAssetId) : null;
      return [draft.key, {
        authorId: draft.authorId,
        boardId: draft.boardId,
        postId: draft.postId,
        content: draft.content,
        media: asset ? {
          assetId: asset.id,
          url: mediaUrl(asset.id),
          type: asset.contentType.startsWith("video/") ? "video" : "image",
          name: asset.name,
          size: asset.size,
          isNew: false,
        } : null,
      }];
    })),
  };
}

router.get("/social/comments", async (req, res): Promise<void> => {
  const parsed = z.object({ postId: z.string().uuid(), cursor: z.string().max(1024).optional() }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Choose a valid post and comment page." }); return; }
  try {
    parseCommentCursor(parsed.data.cursor, parsed.data.postId);
    if (!await findPublicPost(parsed.data.postId)) { res.status(404).json({ error: "Post not found." }); return; }
    const data = await readCommentPages([parsed.data.postId], parsed.data.cursor);
    res.json({ comments: data.comments, pagination: data.pagination[parsed.data.postId] });
  } catch (error) {
    if (error instanceof InteractionCursorError) { res.status(400).json({ error: error.message }); return; }
    throw error;
  }
});

router.get("/social/shelves", async (req, res): Promise<void> => {
  const parsed = z.object({ ownerId: z.string().min(1).max(200).optional(), postId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(0).max(50000).default(0) }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Choose a valid Shelf page." }); return; }
  const userId = currentUserId(req);
  const ownerId = parsed.data.ownerId || userId;
  if (!ownerId) { res.status(401).json({ error: "Sign in to see your Shelves." }); return; }
  res.json(await readShelfPage(userId, ownerId, parsed.data.page, parsed.data.postId ? [parsed.data.postId] : []));
});

router.get("/social/bootstrap", async (req, res): Promise<void> => {
  const selection = contentPageSchema.safeParse(req.query);
  if (!selection.success) {
    res.status(400).json({ error: "The requested content page is invalid." });
    return;
  }
  const userId = currentUserId(req);
  try {
    res.json(await getBootstrap(userId, selection.data));
  } catch (error) {
    if (error instanceof DiscoveryCursorError || error instanceof HttpError) {
      res.status(error instanceof HttpError ? error.status : 400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/social/actions", async (req, res): Promise<void> => {
  const selection = contentPageSchema.safeParse(req.query);
  if (!selection.success) {
    res.status(400).json({ error: "The requested content page is invalid." });
    return;
  }
  const parsed = commandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid action." });
    return;
  }

  const userId = currentUserId(req);
  try {
    const profile = await requireProfile(userId);
    if (selection.data.view) readDiscoveryCursor(selection.data.cursor, discoveryScope(selection.data, userId));
    const payload = parsed.data.payload;
    let interactionPostId: string | null = null;
    let commentResultId: string | null = null;
    let deletedCommentId: string | null = null;
    let extraShelfIds: string[] = [];

    switch (parsed.data.action) {
      case "profile.update": {
        const body = z.object({
          name: z.string().trim().min(1).max(100),
          biography: z.string().trim().max(1000).default(""),
          interests: z.string().trim().max(200).default(""),
          profileImageAssetId: z.string().uuid().nullable().default(null),
        }).strict().parse(payload);
        await requireOwnedMedia(body.profileImageAssetId, profile.id, true);
        await db.update(profiles).set({
          displayName: body.name,
          biography: body.biography,
          interests: body.interests,
          profileImageAssetId: body.profileImageAssetId,
          updatedAt: new Date(),
        }).where(eq(profiles.id, profile.id));
        break;
      }
      case "profile.username": {
        const { username } = changeUsernameSchema.parse(payload);
        const usernameKey = username.toLowerCase();
        const [other] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.usernameKey, usernameKey)).limit(1);
        if (other && other.id !== profile.id) throw new HttpError(409, "That username is already in use.");
        await db.update(profiles).set({ username, usernameKey, updatedAt: new Date() }).where(eq(profiles.id, profile.id));
        break;
      }
      case "board.save": {
        await requireProfile(userId, "Artist");
        const body = z.object({
          artistName: z.string().trim().min(1).max(120),
          discipline: z.string().trim().min(1).max(80),
          biography: z.string().trim().min(1).max(2000),
          profileImageAssetId: z.string().uuid().nullable().default(null),
        }).parse(payload);
        await requireOwnedMedia(body.profileImageAssetId, profile.id, true);
        const [existing] = await db.select().from(artistBoards).where(eq(artistBoards.ownerId, profile.id)).limit(1);
        if (existing) {
          await db.update(artistBoards).set({
            artistName: body.artistName,
            discipline: body.discipline,
            biography: body.biography,
            profileImageAssetId: body.profileImageAssetId,
            updatedAt: new Date(),
          }).where(eq(artistBoards.id, existing.id));
        } else {
          await db.insert(artistBoards).values({ ownerId: profile.id, ...body });
        }
        break;
      }
      case "follow.toggle": {
        await requireProfile(userId, "Fan");
        const body = z.object({ artistId: z.string().min(1) }).parse(payload);
        const [board] = await db.select({ ownerId: artistBoards.ownerId }).from(artistBoards).where(eq(artistBoards.id, body.artistId)).limit(1);
        if (!board || board.ownerId === profile.id) throw new HttpError(404, "Artist board not found.");
        const [existing] = await db.select().from(follows).where(and(eq(follows.fanId, profile.id), eq(follows.artistId, board.ownerId))).limit(1);
        if (existing) await db.delete(follows).where(and(eq(follows.fanId, profile.id), eq(follows.artistId, board.ownerId)));
        else await db.insert(follows).values({ fanId: profile.id, artistId: board.ownerId });
        break;
      }
      case "post.save": {
        await requireProfile(userId, "Fan");
        const body = z.object({
          postId: z.string().uuid().nullable().default(null),
          boardId: z.string().uuid(),
          content: z.string().max(2000).default(""),
          mediaAssetId: z.string().uuid().nullable().default(null),
        }).parse(payload);
        const [board] = await db.select().from(artistBoards).where(eq(artistBoards.id, body.boardId)).limit(1);
        if (!board) throw new HttpError(404, "Artist board not found.");
        if (!body.content.trim() && !body.mediaAssetId) throw new HttpError(400, "Add text or attach an image or video before publishing.");
        await requireOwnedMedia(body.mediaAssetId, profile.id);
        if (body.postId) {
          const [existing] = await db.select().from(posts).where(and(eq(posts.id, body.postId), eq(posts.authorId, profile.id))).limit(1);
          if (!existing || existing.boardId !== board.id) throw new HttpError(403, "You can only edit your own posts.");
          await db.update(posts).set({ content: body.content.trim(), mediaAssetId: body.mediaAssetId, updatedAt: new Date() }).where(eq(posts.id, existing.id));
        } else {
          await db.insert(posts).values({ boardId: board.id, authorId: profile.id, content: body.content.trim(), mediaAssetId: body.mediaAssetId });
        }
        await db.delete(savedPostDrafts).where(eq(savedPostDrafts.key, `${profile.id}::${board.id}::${body.postId || "new"}`));
        break;
      }
      case "draft.save":
      case "draft.delete": {
        await requireProfile(userId, "Fan");
        const body = z.object({
          boardId: z.string().uuid(),
          postId: z.string().uuid().nullable().default(null),
          content: z.string().max(2000).default(""),
          mediaAssetId: z.string().uuid().nullable().default(null),
        }).parse(payload);
        const key = `${profile.id}::${body.boardId}::${body.postId || "new"}`;
        if (parsed.data.action === "draft.delete") {
          await db.delete(savedPostDrafts).where(and(eq(savedPostDrafts.key, key), eq(savedPostDrafts.authorId, profile.id)));
          break;
        }
        const [board] = await db.select({ id: artistBoards.id }).from(artistBoards).where(eq(artistBoards.id, body.boardId)).limit(1);
        if (!board) throw new HttpError(404, "Artist board not found.");
        if (body.postId) {
          const [ownedPost] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, body.postId), eq(posts.authorId, profile.id), eq(posts.boardId, board.id))).limit(1);
          if (!ownedPost) throw new HttpError(403, "You can only edit your own posts.");
        }
        await requireOwnedMedia(body.mediaAssetId, profile.id);
        await db.insert(savedPostDrafts).values({
          key, authorId: profile.id, boardId: body.boardId, postId: body.postId,
          content: body.content, mediaAssetId: body.mediaAssetId,
        }).onConflictDoUpdate({
          target: savedPostDrafts.key,
          set: { content: body.content, mediaAssetId: body.mediaAssetId, updatedAt: new Date() },
        });
        break;
      }
      case "post.delete": {
        await requireProfile(userId, "Fan");
        const body = z.object({ postId: z.string().uuid() }).parse(payload);
        const [existing] = await db.select().from(posts).where(and(eq(posts.id, body.postId), eq(posts.authorId, profile.id))).limit(1);
        if (!existing) throw new HttpError(404, "Post not found.");
        await db.delete(posts).where(eq(posts.id, existing.id));
        break;
      }
      case "comment.save": {
        if (!canComment(profile.role)) throw new HttpError(403, "Only Fans and Artists can comment.");
        const body = commentInput.parse(payload);
        const post = await findPublicPost(body.postId);
        if (!post) throw new HttpError(404, "Post not found.");
        if (body.commentId) {
          const [existing] = await db.select().from(comments).where(and(eq(comments.id, body.commentId), eq(comments.authorId, profile.id))).limit(1);
          if (!existing || existing.postId !== post.id) throw new HttpError(403, "You can only edit your own comments.");
          await db.update(comments).set({ content: body.content, updatedAt: new Date() }).where(eq(comments.id, existing.id));
          commentResultId = existing.id;
        } else {
          const [created] = await db.insert(comments).values({ postId: post.id, authorId: profile.id, content: body.content }).returning({ id: comments.id });
          commentResultId = created.id;
        }
        interactionPostId = post.id;
        break;
      }
      case "comment.delete": {
        if (!canComment(profile.role)) throw new HttpError(403, "Only Fans and Artists can comment.");
        const body = z.object({ commentId: z.string().uuid() }).parse(payload);
        const [existing] = await db.select().from(comments).where(and(eq(comments.id, body.commentId), eq(comments.authorId, profile.id))).limit(1);
        if (!existing) throw new HttpError(404, "Comment not found.");
        await db.delete(comments).where(eq(comments.id, existing.id));
        interactionPostId = existing.postId;
        deletedCommentId = existing.id;
        break;
      }
      case "repost.set":
      case "repost.toggle": {
        await requireProfile(userId, "Fan");
        const body = (parsed.data.action === "repost.set" ? repostInput : repostInput.partial({ active: true })).parse(payload);
        const post = await findPublicPost(body.postId);
        if (!post) throw new HttpError(404, "Post not found.");
        const [existing] = await db.select().from(reposts).where(and(eq(reposts.userId, profile.id), eq(reposts.postId, post.id))).limit(1);
        const active = body.active ?? !existing;
        if (!active) await db.delete(reposts).where(and(eq(reposts.userId, profile.id), eq(reposts.postId, post.id)));
        else await db.insert(reposts).values({ userId: profile.id, postId: post.id }).onConflictDoNothing();
        interactionPostId = post.id;
        break;
      }
      case "shelf.save": {
        const body = z.object({
          shelfId: z.string().uuid().nullable().default(null),
          title: z.string().trim().min(1).max(120),
          description: optionalText(1000).default(""),
          visibility: z.enum(["private", "public"]).default("private"),
        }).parse(payload);
        if (body.shelfId) {
          const [existing] = await db.select().from(shelves).where(and(eq(shelves.id, body.shelfId), eq(shelves.ownerId, profile.id))).limit(1);
          if (!existing) throw new HttpError(404, "Shelf not found.");
          await db.update(shelves).set({ title: body.title, description: body.description, visibility: body.visibility, updatedAt: new Date() }).where(eq(shelves.id, existing.id));
        } else {
          await db.insert(shelves).values({ ownerId: profile.id, title: body.title, description: body.description, visibility: body.visibility });
        }
        break;
      }
      case "shelf.delete": {
        const body = z.object({ shelfId: z.string().uuid() }).parse(payload);
        const deleted = await db.delete(shelves).where(and(eq(shelves.id, body.shelfId), eq(shelves.ownerId, profile.id))).returning({ id: shelves.id });
        if (!deleted.length) throw new HttpError(404, "Shelf not found.");
        break;
      }
      case "shelf.addPost":
      case "shelf.removePost": {
        const body = z.object({ shelfId: z.string().uuid(), postId: z.string().uuid() }).parse(payload);
        const [shelf] = await db.select().from(shelves).where(and(eq(shelves.id, body.shelfId), eq(shelves.ownerId, profile.id))).limit(1);
        if (!shelf) throw new HttpError(404, "Shelf not found.");
        const post = await findPublicPost(body.postId);
        if (!post) throw new HttpError(404, "Post not found.");
        if (parsed.data.action === "shelf.addPost") {
          await db.insert(shelfPosts).values({ shelfId: shelf.id, postId: post.id }).onConflictDoNothing();
        } else {
          await db.delete(shelfPosts).where(and(eq(shelfPosts.shelfId, shelf.id), eq(shelfPosts.postId, post.id)));
        }
        interactionPostId = post.id;
        extraShelfIds = [shelf.id];
        break;
      }
      case "shelf.setPosts": {
        const body = shelfSelectionInput.parse(payload);
        const post = await findPublicPost(body.postId);
        if (!post) throw new HttpError(404, "Post not found.");
        const ownedShelves = await db.select({ id: shelves.id })
          .from(shelves).where(and(eq(shelves.ownerId, profile.id), inArray(shelves.id, body.scopeShelfIds)));
        const ownedIds = ownedShelves.map((shelf) => shelf.id);
        if (body.scopeShelfIds.some((id) => !ownedIds.includes(id))) {
          throw new HttpError(403, "You can only save posts to your own Shelves.");
        }
        await db.transaction(async (tx) => {
          if (ownedIds.length) {
            await tx.delete(shelfPosts).where(and(
              inArray(shelfPosts.shelfId, ownedIds),
              eq(shelfPosts.postId, body.postId),
              body.shelfIds.length ? notInArray(shelfPosts.shelfId, body.shelfIds) : undefined,
            ));
          }
          if (body.shelfIds.length) {
            await tx.insert(shelfPosts).values(
              body.shelfIds.map((shelfId) => ({ shelfId, postId: body.postId })),
            ).onConflictDoNothing();
          }
        });
        interactionPostId = post.id;
        extraShelfIds = ownedIds;
        break;
      }
      default:
        throw new HttpError(400, "Unsupported action.");
    }

    const responseSelection = interactionPostId ? contentPageSchema.parse({ postId: interactionPostId })
      : parsed.data.action === "shelf.delete"
      ? { ...selection.data, shelfId: undefined, shelfList: "true" as const } : selection.data;
    const data = await getBootstrap(userId, responseSelection, extraShelfIds);
    const commentResult = commentResultId && interactionPostId
      ? (await readCommentPages([interactionPostId], undefined, commentResultId)).comments[0] : undefined;
    res.json({ ...data, ...(interactionPostId ? { interactionPostId, commentResult, deletedCommentId } : {}) });
  } catch (error) {
    if (error instanceof DiscoveryCursorError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Some submitted information is invalid." });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const dbError = error as { code?: string; cause?: { code?: string } };
    const code = dbError?.code || dbError?.cause?.code || "";
    if (code === "23505") {
      res.status(409).json({ error: "That item already exists." });
      return;
    }
    if (code === "23503") {
      res.status(409).json({ error: "That post or Shelf is no longer available. Refresh and try again." });
      return;
    }
    req.log.error({ err: error }, "Stillroom data action failed");
    res.status(500).json({ error: "That change could not be saved. Please try again." });
  }
});

export default router;
