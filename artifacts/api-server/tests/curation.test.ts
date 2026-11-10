import test from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, uuid } from "drizzle-orm/pg-core";
import { changeFeaturedIds, curationCommand, moveCurationItem } from "../src/lib/curationValidation.ts";
import { collectionSummaryFields } from "../src/lib/curationSql.ts";

const postId = "00000000-0000-4000-8000-000000000001";
const collectionId = "00000000-0000-4000-8000-000000000002";
test("feature maximum is five and retries are idempotent, including at capacity", () => {
  let ids: string[] = [];
  for (let i = 0; i < 5; i++) ids = changeFeaturedIds(ids, `p${i}`, true);
  assert.equal(ids.length, 5);
  assert.deepEqual(changeFeaturedIds(ids, "p2", true), ids);
  assert.throws(() => changeFeaturedIds(ids, "sixth", true), /up to 5/);
  assert.equal(changeFeaturedIds(ids, "p2", false).length, 4);
  assert.deepEqual(changeFeaturedIds(ids, "missing", false), ids);
  assert.deepEqual(ids, ["p0", "p1", "p2", "p3", "p4"]);
});
test("feature reordering preserves originals, boundaries, and input immutability", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveCurationItem(ids, 1, "up"), ["b", "a", "c"]);
  assert.deepEqual(moveCurationItem(ids, 1, "down"), ["a", "c", "b"]);
  assert.deepEqual(moveCurationItem(ids, 0, "up"), ids);
  assert.deepEqual(moveCurationItem(ids, 2, "down"), ids);
  assert.deepEqual(moveCurationItem(ids, -1, "down"), ids);
  assert.deepEqual(ids, ["a", "b", "c"]);
});
test("curation commands reject spoofed owners, invalid IDs, empty titles and implicit toggles", () => {
  for (const body of [
    { action: "feature.set", payload: { postId } },
    { action: "feature.set", payload: { postId, active: true, ownerId: "other" } },
    { action: "feature.move", payload: { postId, direction: "sideways" } },
    { action: "collection.save", payload: { collectionId: null, title: " " } },
    { action: "collection.save", payload: { collectionId: null, title: "x".repeat(101) } },
    { action: "collection.post", payload: { collectionId, postId: "bad", active: true } },
    { action: "collection.delete", payload: { collectionId, deleteOriginal: true } },
    { action: "post.delete", payload: { postId } },
  ]) assert.equal(curationCommand.safeParse(body).success, false);
  assert.equal(curationCommand.parse({ action: "collection.save", payload: { collectionId: null, title: "  My art  " } }).payload.title, "My art");
});
test("all supported curation actions require narrowly scoped server-verifiable identifiers", () => {
  for (const body of [
    { action: "feature.set", payload: { postId, active: true } },
    { action: "feature.move", payload: { postId, direction: "down" } },
    { action: "collection.save", payload: { collectionId, title: "Title", description: "" } },
    { action: "collection.delete", payload: { collectionId } },
    { action: "collection.move", payload: { collectionId, direction: "up" } },
    { action: "collection.post", payload: { collectionId, postId, active: false } },
  ]) assert.equal(curationCommand.safeParse(body).success, true);
});
test("compiled Collection summaries retain qualified original/media correlations", () => {
  const noNetwork = drizzle({ client: { query() { throw new Error("No network"); } } as never });
  const table = pgTable("stillroom_artist_collections", { id: uuid("id") });
  const { sql } = noNetwork.select(collectionSummaryFields).from(table).toSQL();
  assert.match(sql, /"member"\."collection_id" = "stillroom_artist_collections"\."id"/);
  assert.match(sql, /"original"\."id" = "member"\."post_id"/);
  assert.match(sql, /"asset"\."id" = "original"\."media_asset_id"/);
});
