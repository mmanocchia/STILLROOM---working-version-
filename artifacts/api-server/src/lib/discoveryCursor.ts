import { createHash } from "node:crypto";
import { z } from "zod";
import { and, sql, type SQL } from "drizzle-orm";
import type { ContentPage } from "./contentPage";

const timestamp = z.string().datetime({ precision: 6 });
const position = z.object({ time: timestamp, id: z.string().min(1).max(200) }).strict();
const cursorSchema = z.object({
  version: z.literal(1),
  scope: z.string().length(64),
  snapshot: timestamp,
  posts: position.extend({ id: z.string().uuid() }).nullable(),
  artists: position.nullable(),
  boards: position.extend({ id: z.string().uuid() }).nullable(),
}).strict();
export type DiscoveryCursor = z.infer<typeof cursorSchema>;
export type CursorPosition = z.infer<typeof position>;

export function cursorForWindow(rows: { id: string; cursorTime: string }[], limit: number) {
  if (rows.length <= limit) return null;
  const last = rows[limit - 1];
  return { id: last.id, time: last.cursorTime };
}

export function keysetBoundary(time: SQL, id: SQL, snapshot: string, position?: CursorPosition | null) {
  return and(sql`${time} <= ${snapshot}::timestamptz`, position
    ? sql`(${time}, ${id}) < (${position.time}::timestamptz, ${position.id})`
    : undefined);
}

export class DiscoveryCursorError extends Error {}

export function discoveryScope(selection: ContentPage, userId: string | null) {
  return createHash("sha256").update(JSON.stringify({
    view: selection.view,
    q: (selection.q || "").trim().toLowerCase().replaceAll("@", ""),
    category: selection.category || "",
    followed: selection.followed === "true",
    viewer: selection.followed ? userId : null,
  })).digest("hex");
}

export function validDiscoveryCursor(value: string) {
  try { return cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))).success; }
  catch { return false; }
}

export function readDiscoveryCursor(value: string | undefined, scope: string) {
  if (!value) return null;
  try {
    const decoded = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (decoded.scope !== scope) throw new Error("Scope mismatch");
    return decoded;
  } catch {
    throw new DiscoveryCursorError("This content cursor is invalid for the selected feed or search. Start again.");
  }
}

export function writeDiscoveryCursor(value: DiscoveryCursor) {
  return Buffer.from(JSON.stringify(cursorSchema.parse(value))).toString("base64url");
}
