import { z } from "zod";
const commentCursorSchema = z.object({
  postId: z.string().uuid(), id: z.string().uuid(), time: z.string().datetime({ precision: 6 }),
}).strict();
export class InteractionCursorError extends Error {}
export function parseCommentCursor(value: string | undefined, postId: string) {
  if (!value) return null;
  try {
    const cursor = commentCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (cursor.postId !== postId) throw new Error("Different post");
    return cursor;
  } catch { throw new InteractionCursorError("The comment cursor is invalid. Open the comments again."); }
}
export const canComment = (role: string) => role === "Fan" || role === "Artist";
export const commentInput = z.object({
  commentId: z.string().uuid().nullable().default(null), postId: z.string().uuid(),
  content: z.string().trim().min(1).max(1000),
}).strict();
export const repostInput = z.object({ postId: z.string().uuid(), active: z.boolean() }).strict();
export const shelfSelectionInput = z.object({
  postId: z.string().uuid(),
  shelfIds: z.array(z.string().uuid()).max(1000),
  scopeShelfIds: z.array(z.string().uuid()).min(1).max(1000),
}).strict().refine((value) => value.shelfIds.every((id) => value.scopeShelfIds.includes(id)),
  "Select only loaded Shelves.")
  .transform((value) => ({ ...value, shelfIds: [...new Set(value.shelfIds)], scopeShelfIds: [...new Set(value.scopeShelfIds)] }));
