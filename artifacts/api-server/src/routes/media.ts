import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import type { Request } from "express";
import { Readable } from "stream";
import { z } from "zod";
import { artistBoards, db, mediaAssets, posts, profiles } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const storage = new ObjectStorageService();
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const boardImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const videoTypes = new Set(["video/mp4", "video/webm"]);

function userId(req: Request): string | null {
  return getAuth(req).userId ?? null;
}

function allowedUpload(
  purpose: "profile" | "board" | "post",
  contentType: string,
  size: number,
): boolean {
  const isImage = (purpose === "profile" || purpose === "board"
    ? boardImageTypes
    : imageTypes).has(contentType);
  const maxBytes =
    purpose === "profile" || purpose === "board"
      ? 4 * 1024 * 1024
      : contentType.startsWith("video/")
        ? 25 * 1024 * 1024
        : 10 * 1024 * 1024;
  return (isImage || (purpose === "post" && videoTypes.has(contentType)))
    && Number.isSafeInteger(size)
    && size > 0
    && size <= maxBytes;
}

router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  const ownerId = userId(req);
  if (!ownerId) {
    res.status(401).json({ error: "Sign in to upload media." });
    return;
  }

  const parsed = z.object({
    name: z.string().trim().min(1).max(255),
    size: z.number().int().positive(),
    contentType: z.string().min(1).max(100),
    purpose: z.enum(["profile", "board", "post"]),
  }).safeParse(req.body);
  if (!parsed.success || !allowedUpload(
    parsed.data.purpose,
    parsed.data.contentType,
    parsed.data.size,
  )) {
    res.status(400).json({ error: "This file type or size is not supported." });
    return;
  }

  const [profile] = await db.select({ id: profiles.id, role: profiles.role })
    .from(profiles).where(eq(profiles.id, ownerId)).limit(1);
  if (!profile || (parsed.data.purpose === "board" && profile.role !== "Artist")
    || (parsed.data.purpose === "post" && profile.role !== "Fan")) {
    res.status(403).json({ error: "Your account cannot upload this type of media." });
    return;
  }

  try {
    const { uploadURL, objectPath } = await storage.getObjectEntityUploadURL();
    const [asset] = await db.insert(mediaAssets).values({
      ownerId,
      objectPath,
      name: parsed.data.name,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
      status: "pending",
    }).returning();
    res.status(201).json({
      uploadURL,
      assetId: asset.id,
      mediaUrl: `/api/media/${asset.id}`,
    });
  } catch (error) {
    req.log.error({ err: error }, "Could not create secure media upload");
    res.status(503).json({ error: "Media uploads are temporarily unavailable." });
  }
});

router.post("/storage/uploads/complete", async (req, res): Promise<void> => {
  const ownerId = userId(req);
  if (!ownerId) {
    res.status(401).json({ error: "Sign in to finish uploading media." });
    return;
  }
  const parsed = z.object({ assetId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Upload reference is invalid." });
    return;
  }
  const [asset] = await db.select().from(mediaAssets).where(and(
    eq(mediaAssets.id, parsed.data.assetId),
    eq(mediaAssets.ownerId, ownerId),
    eq(mediaAssets.status, "pending"),
  )).limit(1);
  if (!asset) {
    res.status(404).json({ error: "Upload was not found." });
    return;
  }
  try {
    const file = await storage.getObjectEntityFile(asset.objectPath);
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size || 0);
    const actualType = String(metadata.contentType || "");
    if (actualSize !== asset.size || actualType !== asset.contentType) {
      res.status(400).json({ error: "Uploaded file metadata did not match the request." });
      return;
    }
    const [readyAsset] = await db.update(mediaAssets)
      .set({ status: "ready" })
      .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.ownerId, ownerId)))
      .returning();
    res.json({ assetId: readyAsset.id, mediaUrl: `/api/media/${readyAsset.id}` });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(400).json({ error: "The file has not reached storage yet." });
      return;
    }
    req.log.error({ err: error }, "Could not verify uploaded media");
    res.status(503).json({ error: "The uploaded file could not be verified." });
  }
});

router.get("/media/:assetId", async (req, res): Promise<void> => {
  const assetId = Array.isArray(req.params.assetId)
    ? req.params.assetId[0]
    : req.params.assetId;
  const parsedId = z.string().uuid().safeParse(assetId);
  if (!parsedId.success) {
    res.status(404).json({ error: "Media not found." });
    return;
  }
  const [asset] = await db.select().from(mediaAssets).where(and(
    eq(mediaAssets.id, parsedId.data),
    eq(mediaAssets.status, "ready"),
  )).limit(1);
  if (!asset) {
    res.status(404).json({ error: "Media not found." });
    return;
  }

  const [publicProfile, publicBoard, publicPost] = await Promise.all([
    db.select({ id: profiles.id }).from(profiles)
      .where(eq(profiles.profileImageAssetId, asset.id)).limit(1),
    db.select({ id: artistBoards.id }).from(artistBoards)
      .where(eq(artistBoards.profileImageAssetId, asset.id)).limit(1),
    db.select({ id: posts.id }).from(posts)
      .where(eq(posts.mediaAssetId, asset.id)).limit(1),
  ]);
  const isPublic = publicProfile.length > 0 || publicBoard.length > 0 || publicPost.length > 0;
  if (!isPublic && userId(req) !== asset.ownerId) {
    res.status(404).json({ error: "Media not found." });
    return;
  }

  try {
    const file = await storage.getObjectEntityFile(asset.objectPath);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", isPublic ? "public, max-age=3600" : "private, no-store");
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Media not found." });
      return;
    }
    req.log.error({ err: error }, "Could not serve uploaded media");
    res.status(503).json({ error: "Media is temporarily unavailable." });
  }
});

export default router;
