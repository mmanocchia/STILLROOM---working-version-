import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, getTableColumns, gt, lt } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { GetBoardCurationParams, GetBoardCurationQueryParams, GetBoardCurationResponse, ManageBoardCurationBody } from "@workspace/api-zod";
import { artistBoards, artistCollectionPosts, artistCollections, db, featuredPosts, posts, profiles } from "@workspace/db";
import { contentPageSchema, pageWindow } from "../lib/contentPage";
import { changeFeaturedIds, curationCommand, moveCurationItem } from "../lib/curationValidation";
import { collectionSummaryFields } from "../lib/curationSql";
import { getBootstrap } from "./social";

const router: IRouter = Router();
class CurationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const collectionFields = { ...getTableColumns(artistCollections), ...collectionSummaryFields };
function presentCollection(row: typeof artistCollections.$inferSelect & { postCount: number; coverId: string | null; coverType: string | null }) {
  return {
    id: row.id, boardId: row.boardId, title: row.title, description: row.description,
    position: row.position, postCount: row.postCount,
    cover: row.coverId ? { url: `/api/media/${row.coverId}`, type: row.coverType?.startsWith("video/") ? "video" as const : "image" as const } : null,
  };
}

router.get("/social/boards/:boardId/curation", async (req, res): Promise<void> => {
  const params = GetBoardCurationParams.safeParse(req.params);
  const query = GetBoardCurationQueryParams.safeParse(req.query);
  if (!params.success || !query.success) { res.status(400).json({ error: "Choose a valid Board or Collection page." }); return; }
  const { boardId } = params.data;
  const { collectionId, page = 0, collectionPage = 0 } = query.data;
  const [board] = await db.select({ id: artistBoards.id }).from(artistBoards).where(eq(artistBoards.id, boardId));
  if (!board) { res.status(404).json({ error: "Artist Board not found." }); return; }
  const [featured, collectionRows, selectedRows, members] = await Promise.all([
    db.select().from(featuredPosts).where(eq(featuredPosts.boardId, boardId)).orderBy(asc(featuredPosts.position)),
    db.select(collectionFields).from(artistCollections).where(eq(artistCollections.boardId, boardId))
      .orderBy(asc(artistCollections.position), asc(artistCollections.id)).limit(21).offset(collectionPage * 20),
    collectionId ? db.select(collectionFields).from(artistCollections)
      .where(and(eq(artistCollections.id, collectionId), eq(artistCollections.boardId, boardId))) : Promise.resolve([]),
    collectionId ? db.select({ postId: artistCollectionPosts.postId }).from(artistCollectionPosts)
      .where(and(eq(artistCollectionPosts.collectionId, collectionId), eq(artistCollectionPosts.boardId, boardId)))
      .orderBy(desc(artistCollectionPosts.addedAt), desc(artistCollectionPosts.postId)).limit(21).offset(page * 20) : Promise.resolve([]),
  ]);
  if (collectionId && !selectedRows.length) { res.status(404).json({ error: "Collection not found." }); return; }
  const collectionWindow = pageWindow(collectionRows, collectionPage);
  const postWindow = pageWindow(members, page);
  const postIds = [...new Set([...featured.map((row) => row.postId), ...postWindow.rows.map((row) => row.postId)])];
  const snapshot = await getBootstrap(getAuth(req).userId, contentPageSchema.parse({ boardId }), [], postIds);
  const available = new Set(snapshot.posts.map((row) => row.id));
  res.json(GetBoardCurationResponse.parse({
    boardId, featuredPostIds: featured.map((row) => row.postId).filter((id) => available.has(id)),
    collections: collectionWindow.rows.map(presentCollection), collectionPagination: collectionWindow.pagination,
    selectedCollection: selectedRows[0] ? presentCollection(selectedRows[0]) : null,
    collectionPostIds: postWindow.rows.map((row) => row.postId).filter((id) => available.has(id)),
    postPagination: postWindow.pagination, snapshot,
  }));
});

router.post("/social/boards/:boardId/curation", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Sign in to manage your Artist Board." }); return; }
  const params = GetBoardCurationParams.safeParse(req.params);
  const envelope = ManageBoardCurationBody.safeParse(req.body);
  const parsed = envelope.success ? curationCommand.safeParse(req.body) : null;
  if (!params.success || !parsed?.success) { res.status(400).json({ error: "Check the curation fields and try again." }); return; }
  const boardId = params.data.boardId;
  const command = parsed.data;
  try {
    await db.transaction(async (tx) => {
      const [profile] = await tx.select().from(profiles).where(eq(profiles.id, userId));
      if (profile?.role !== "Artist") throw new CurationError(403, "Only Artists can manage Board curation.");
      // A Board row lock serializes ALL curation mutations, including count checks
      // and ordering. Concurrent tabs cannot exceed the maximum or lose updates.
      const [board] = await tx.select().from(artistBoards).where(eq(artistBoards.id, boardId)).for("update");
      if (!board || board.ownerId !== userId) throw new CurationError(403, "You can only curate your own Artist Board.");
      const requirePost = async (postId: string) => {
        const [post] = await tx.select({ id: posts.id }).from(posts)
          .innerJoin(profiles, eq(profiles.id, posts.authorId))
          .where(and(eq(posts.id, postId), eq(posts.boardId, boardId), eq(profiles.role, "Fan")));
        if (!post) throw new CurationError(404, "Choose an available Fan post from your own Board.");
      };
      const requireCollection = async (collectionId: string) => {
        const [collection] = await tx.select().from(artistCollections)
          .where(and(eq(artistCollections.id, collectionId), eq(artistCollections.boardId, boardId)));
        if (!collection) throw new CurationError(404, "Collection not found on your Board.");
        return collection;
      };
      switch (command.action) {
        case "feature.set":
        case "feature.move": {
          const body = command.payload;
          await requirePost(body.postId);
          const previous = await tx.select().from(featuredPosts).where(eq(featuredPosts.boardId, boardId)).orderBy(asc(featuredPosts.position));
          const ids = previous.map((row) => row.postId);
          let next: string[];
          if (command.action === "feature.set") {
            try { next = changeFeaturedIds(ids, body.postId, command.payload.active); }
            catch (error) { throw new CurationError(409, (error as Error).message); }
          } else {
            if (!ids.includes(body.postId)) throw new CurationError(404, "That post is no longer featured.");
            next = moveCurationItem(ids, ids.indexOf(body.postId), command.payload.direction);
          }
          await tx.delete(featuredPosts).where(eq(featuredPosts.boardId, boardId));
          if (next.length) await tx.insert(featuredPosts).values(next.map((postId, position) => ({ boardId, postId, position })));
          break;
        }
        case "collection.save": {
          const { collectionId, title, description } = command.payload;
          if (collectionId) {
            await requireCollection(collectionId);
            await tx.update(artistCollections).set({ title, description, updatedAt: new Date() }).where(eq(artistCollections.id, collectionId));
          } else {
            const [last] = await tx.select({ position: artistCollections.position }).from(artistCollections)
              .where(eq(artistCollections.boardId, boardId)).orderBy(desc(artistCollections.position)).limit(1);
            await tx.insert(artistCollections).values({ boardId, title, description, position: (last?.position ?? -1) + 1 });
          }
          break;
        }
        case "collection.delete":
          await requireCollection(command.payload.collectionId);
          await tx.delete(artistCollections).where(eq(artistCollections.id, command.payload.collectionId));
          break;
        case "collection.move": {
          const collection = await requireCollection(command.payload.collectionId);
          const up = command.payload.direction === "up";
          const [neighbor] = await tx.select().from(artistCollections)
            .where(and(eq(artistCollections.boardId, boardId),
              up ? lt(artistCollections.position, collection.position) : gt(artistCollections.position, collection.position)))
            .orderBy(up ? desc(artistCollections.position) : asc(artistCollections.position)).limit(1);
          if (neighbor) {
            await tx.update(artistCollections).set({ position: neighbor.position }).where(eq(artistCollections.id, collection.id));
            await tx.update(artistCollections).set({ position: collection.position }).where(eq(artistCollections.id, neighbor.id));
          }
          break;
        }
        case "collection.post": {
          const { collectionId, postId, active } = command.payload;
          await requireCollection(collectionId);
          await requirePost(postId);
          if (active) await tx.insert(artistCollectionPosts).values({ boardId, collectionId, postId }).onConflictDoNothing();
          else await tx.delete(artistCollectionPosts).where(and(eq(artistCollectionPosts.collectionId, collectionId), eq(artistCollectionPosts.postId, postId)));
          break;
        }
      }
    });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof CurationError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Check the curation fields." }); return; }
    const code = (error as { code?: string }).code;
    if (code === "23503" || code === "23505" || code === "23514") {
      res.status(409).json({ error: "That content changed or is no longer available. Refresh and try again." }); return;
    }
    throw error;
  }
});
export default router;
