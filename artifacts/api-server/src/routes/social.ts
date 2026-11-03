import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
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

async function getBootstrap(userId: string | null) {
  const [profileRows, boardRows, postRows, repostRows, commentRows, shelfRows, mediaRows] =
    await Promise.all([
      db.select().from(profiles).orderBy(asc(profiles.createdAt)),
      db.select().from(artistBoards).orderBy(desc(artistBoards.createdAt)),
      db.select().from(posts).orderBy(asc(posts.publishedAt)),
      db.select().from(reposts).orderBy(asc(reposts.repostedAt)),
      db.select().from(comments).orderBy(asc(comments.createdAt)),
      db
        .select()
        .from(shelves)
        .where(
          userId
            ? or(eq(shelves.visibility, "public"), eq(shelves.ownerId, userId))
            : eq(shelves.visibility, "public"),
        )
        .orderBy(desc(shelves.createdAt)),
      db.select().from(mediaAssets).where(eq(mediaAssets.status, "ready")),
    ]);

  const accountById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const mediaById = new Map(mediaRows.map((asset) => [asset.id, asset]));
  const boardById = new Map(boardRows.map((board) => [board.id, board]));
  const postById = new Map(postRows.map((post) => [post.id, post]));
  const availableShelfIds = shelfRows.map((shelf) => shelf.id);
  const savedRows = availableShelfIds.length
    ? await db.select().from(shelfPosts).where(inArray(shelfPosts.shelfId, availableShelfIds))
    : [];
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
  const presentedComments = commentRows
    .filter((comment) => postById.has(comment.postId) && accountById.has(comment.authorId))
    .map((comment) => ({
      id: comment.id,
      postId: comment.postId,
      authorId: comment.authorId,
      authorUsername: accountById.get(comment.authorId)?.username || "",
      content: comment.content,
      createdAt: comment.createdAt.getTime(),
      updatedAt: comment.updatedAt.getTime(),
    }));
  const presentedShelves = shelfRows.map((shelf) => ({
    id: shelf.id,
    ownerId: shelf.ownerId,
    title: shelf.title,
    description: shelf.description,
    visibility: shelf.visibility,
    postIds: savedRows
      .filter((saved) => saved.shelfId === shelf.id && postById.has(saved.postId))
      .sort((left, right) => left.addedAt.getTime() - right.addedAt.getTime())
      .map((saved) => saved.postId),
    createdAt: shelf.createdAt.getTime(),
    updatedAt: shelf.updatedAt.getTime(),
  }));

  return {
    userId,
    profileId: userId && accountById.has(userId) ? userId : null,
    accounts: presentedProfiles,
    boards: presentedBoards,
    posts: presentedPosts,
    comments: presentedComments,
    reposts: repostRows
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

router.get("/social/bootstrap", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  res.json(await getBootstrap(userId));
});

router.post("/social/actions", async (req, res): Promise<void> => {
  const parsed = commandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid action." });
    return;
  }

  const userId = currentUserId(req);
  try {
    const profile = await requireProfile(userId);
    const payload = parsed.data.payload;

    switch (parsed.data.action) {
      case "profile.update": {
        const body = z.object({
          name: z.string().trim().min(1).max(100),
          biography: z.string().trim().max(1000).default(""),
          interests: z.string().trim().max(200).default(""),
          profileImageAssetId: z.string().uuid().nullable().default(null),
        }).parse(payload);
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
        const body = z.object({ username: z.string().trim().min(1).max(32) }).parse(payload);
        const username = body.username.replace(/^@/, "");
        if (!username) throw new HttpError(400, "Choose a username.");
        const usernameKey = username.toLocaleLowerCase();
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
        await requireProfile(userId, "Fan");
        const body = z.object({
          commentId: z.string().uuid().nullable().default(null),
          postId: z.string().uuid(),
          content: z.string().trim().min(1).max(1000),
        }).parse(payload);
        const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, body.postId)).limit(1);
        if (!post) throw new HttpError(404, "Post not found.");
        if (body.commentId) {
          const [existing] = await db.select().from(comments).where(and(eq(comments.id, body.commentId), eq(comments.authorId, profile.id))).limit(1);
          if (!existing || existing.postId !== post.id) throw new HttpError(403, "You can only edit your own comments.");
          await db.update(comments).set({ content: body.content, updatedAt: new Date() }).where(eq(comments.id, existing.id));
        } else {
          await db.insert(comments).values({ postId: post.id, authorId: profile.id, content: body.content });
        }
        break;
      }
      case "comment.delete": {
        await requireProfile(userId, "Fan");
        const body = z.object({ commentId: z.string().uuid() }).parse(payload);
        const [existing] = await db.select().from(comments).where(and(eq(comments.id, body.commentId), eq(comments.authorId, profile.id))).limit(1);
        if (!existing) throw new HttpError(404, "Comment not found.");
        await db.delete(comments).where(eq(comments.id, existing.id));
        break;
      }
      case "repost.toggle": {
        await requireProfile(userId, "Fan");
        const body = z.object({ postId: z.string().uuid() }).parse(payload);
        const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, body.postId)).limit(1);
        if (!post) throw new HttpError(404, "Post not found.");
        const [existing] = await db.select().from(reposts).where(and(eq(reposts.userId, profile.id), eq(reposts.postId, post.id))).limit(1);
        if (existing) await db.delete(reposts).where(eq(reposts.id, existing.id));
        else await db.insert(reposts).values({ userId: profile.id, postId: post.id }).onConflictDoNothing();
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
        await db.delete(shelves).where(and(eq(shelves.id, body.shelfId), eq(shelves.ownerId, profile.id)));
        break;
      }
      case "shelf.addPost":
      case "shelf.removePost": {
        const body = z.object({ shelfId: z.string().uuid(), postId: z.string().uuid() }).parse(payload);
        const [shelf] = await db.select().from(shelves).where(and(eq(shelves.id, body.shelfId), eq(shelves.ownerId, profile.id))).limit(1);
        if (!shelf) throw new HttpError(404, "Shelf not found.");
        const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, body.postId)).limit(1);
        if (!post) throw new HttpError(404, "Post not found.");
        if (parsed.data.action === "shelf.addPost") {
          await db.insert(shelfPosts).values({ shelfId: shelf.id, postId: post.id }).onConflictDoNothing();
        } else {
          await db.delete(shelfPosts).where(and(eq(shelfPosts.shelfId, shelf.id), eq(shelfPosts.postId, post.id)));
        }
        break;
      }
      case "shelf.setPosts": {
        const body = z.object({
          postId: z.string().uuid(),
          shelfIds: z.array(z.string().uuid()).max(100),
        }).parse(payload);
        const [post] = await db.select({ id: posts.id })
          .from(posts).where(eq(posts.id, body.postId)).limit(1);
        if (!post) throw new HttpError(404, "Post not found.");
        const ownedShelves = await db.select({ id: shelves.id })
          .from(shelves).where(eq(shelves.ownerId, profile.id));
        const ownedIds = ownedShelves.map((shelf) => shelf.id);
        if (body.shelfIds.some((id) => !ownedIds.includes(id))) {
          throw new HttpError(403, "You can only save posts to your own Shelves.");
        }
        await db.transaction(async (tx) => {
          if (ownedIds.length) {
            await tx.delete(shelfPosts).where(and(
              inArray(shelfPosts.shelfId, ownedIds),
              eq(shelfPosts.postId, body.postId),
            ));
          }
          if (body.shelfIds.length) {
            await tx.insert(shelfPosts).values(
              body.shelfIds.map((shelfId) => ({ shelfId, postId: body.postId })),
            ).onConflictDoNothing();
          }
        });
        break;
      }
      default:
        throw new HttpError(400, "Unsupported action.");
    }

    res.json(await getBootstrap(userId));
  } catch (error) {
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
    req.log.error({ err: error }, "Stillroom data action failed");
    res.status(500).json({ error: "That change could not be saved. Please try again." });
  }
});

export default router;
