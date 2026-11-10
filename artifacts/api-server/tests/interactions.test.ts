import test from "node:test";
import assert from "node:assert/strict";
import { canComment, commentInput, parseCommentCursor, InteractionCursorError, repostInput, shelfSelectionInput } from "../src/lib/interactionValidation.ts";
import { combineFeedWindow } from "../src/lib/feedWindow.ts";
import { shelfSummaryFields } from "../src/lib/interactionSql.ts";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, uuid } from "drizzle-orm/pg-core";
const postId = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";

test("single-table Shelf queries retain fully qualified correlated cover columns", () => {
  const noNetwork = drizzle({ client: { query() { throw new Error("No network in this unit test"); } } as never });
  const table = pgTable("stillroom_shelves", { id: uuid("id") });
  const query = noNetwork.select(shelfSummaryFields).from(table).toSQL();
  assert.match(query.sql, /"cover_post"\."id" = "cover_saved"\."post_id"/);
  assert.match(query.sql, /"cover_asset"\."id" = "cover_post"\."media_asset_id"/);
  assert.match(query.sql, /"saved"\."shelf_id" = "stillroom_shelves"\."id"/);
});

test("Fans and Artists can comment; bodies cannot choose author, role, or owner", () => {
  assert.equal(canComment("Fan"), true);
  assert.equal(canComment("Artist"), true);
  assert.equal(canComment("visitor"), false);
  assert.equal(commentInput.parse({ postId, content: "  A note  " }).content, "A note");
  for (const body of [{ postId, content: "" }, { postId, content: " ".repeat(2) },
    { postId, content: "note", authorId: "another-user" }, { postId, content: "note", role: "Artist" }]) {
    assert.equal(commentInput.safeParse(body).success, false);
  }
});
test("comment cursors retain native precision and cannot be reused on another post", () => {
  const value = { postId, id, time: "2026-11-10T05:00:00.123456Z" };
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  assert.deepEqual(parseCommentCursor(encoded, postId), value);
  assert.throws(() => parseCommentCursor(encoded, id), InteractionCursorError);
  assert.throws(() => parseCommentCursor("garbage", postId), InteractionCursorError);
});
test("repost mutations require an explicit desired state rather than a retry-unsafe toggle", () => {
  assert.equal(repostInput.parse({ postId, active: false }).active, false);
  assert.equal(repostInput.parse({ postId, active: true }).active, true);
  assert.equal(repostInput.safeParse({ postId }).success, false);
  assert.equal(repostInput.safeParse({ postId, active: true, userId: "other" }).success, false);
});
test("Shelf selections are deduplicated and restricted to the loaded scope", () => {
  assert.deepEqual(shelfSelectionInput.parse({ postId, shelfIds: [id, id], scopeShelfIds: [id, id] }),
    { postId, shelfIds: [id], scopeShelfIds: [id] });
  assert.equal(shelfSelectionInput.safeParse({ postId, shelfIds: [postId], scopeShelfIds: [id] }).success, false);
  assert.equal(shelfSelectionInput.safeParse({ postId, shelfIds: [], scopeShelfIds: [id] }).success, true);
});
test("Feed pages merge posts with recent repost events of older originals", () => {
  const posts = [{ id: "p1", cursorTime: "2026-11-09T01:00:00.000001Z" }];
  const reposts = [{ id: "r1", cursorTime: "2026-11-10T01:00:00.000002Z" }];
  const page = combineFeedWindow(posts, reposts, 1);
  assert.equal(page.reposts[0].id, "r1");
  assert.deepEqual(page.posts, []);
  assert.equal(page.positions.posts, undefined, "unconsumed source must remain at its beginning");
  assert.equal(page.hasMore, true);
});
test("merged Feed pagination consumes every tied event exactly once across both sources", () => {
  const posts = Array.from({ length: 45 }, (_, i) => ({ id: `p${String(99 - i).padStart(2, "0")}`, cursorTime: `2026-11-10T05:00:${String(59 - Math.floor(i / 2)).padStart(2, "0")}.123456Z` }));
  const reposts = posts.slice(0, 30).map((row, i) => ({ ...row, id: `r${String(99 - i).padStart(2, "0")}` }));
  let previous: { posts?: { id: string; time: string } | null; reposts?: { id: string; time: string } | null } = {};
  const seen = [];
  const after = (rows: typeof posts, position: typeof previous.posts) => position === null ? []
    : rows.filter((row) => !position || row.cursorTime < position.time || (row.cursorTime === position.time && row.id < position.id)).slice(0, 21);
  for (let i = 0; i < 10; i++) {
    const page = combineFeedWindow(after(posts, previous.posts), after(reposts, previous.reposts), 20, previous);
    seen.push(...page.posts.map((row) => row.id), ...page.reposts.map((row) => row.id));
    previous = page.positions;
    if (!page.hasMore) break;
  }
  assert.equal(seen.length, 75);
  assert.equal(new Set(seen).size, 75);
});
