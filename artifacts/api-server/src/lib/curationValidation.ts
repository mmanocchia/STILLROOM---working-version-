import { z } from "zod";

const postId = z.string().uuid();
const collectionId = z.string().uuid();
const direction = z.enum(["up", "down"]);
export const curationCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("feature.set"), payload: z.object({ postId, active: z.boolean() }).strict() }).strict(),
  z.object({ action: z.literal("feature.move"), payload: z.object({ postId, direction }).strict() }).strict(),
  z.object({ action: z.literal("collection.save"), payload: z.object({
    collectionId: collectionId.nullable(), title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).default(""),
  }).strict() }).strict(),
  z.object({ action: z.literal("collection.delete"), payload: z.object({ collectionId }).strict() }).strict(),
  z.object({ action: z.literal("collection.move"), payload: z.object({ collectionId, direction }).strict() }).strict(),
  z.object({ action: z.literal("collection.post"), payload: z.object({ collectionId, postId, active: z.boolean() }).strict() }).strict(),
]);

/** Immutable reordering shared by feature mutations and pure regression tests. */
export function moveCurationItem<T>(items: T[], index: number, direction: "up" | "down"): T[] {
  const next = direction === "up" ? index - 1 : index + 1;
  const result = [...items];
  if (index < 0 || index >= items.length || next < 0 || next >= items.length) return result;
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}

export function changeFeaturedIds(ids: string[], postId: string, active: boolean): string[] {
  if (!active) return ids.filter((id) => id !== postId);
  if (ids.includes(postId)) return [...ids];
  if (ids.length >= 5) throw new Error("You can feature up to 5 posts. Remove a featured post first.");
  return [...ids, postId];
}
