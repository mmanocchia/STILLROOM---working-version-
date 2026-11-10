import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { contentPageSchema } from "../src/lib/contentPage.ts";
import { cursorForWindow, discoveryScope, readDiscoveryCursor, writeDiscoveryCursor, keysetBoundary, DiscoveryCursorError } from "../src/lib/discoveryCursor.ts";
import { categoryCondition, searchTerms, textMatch } from "../src/lib/discoverySearch.ts";

const snapshot = "2026-11-10T10:00:00.123456Z";
const position = { id: "00000000-0000-4000-8000-000000000001", time: "2026-11-10T09:00:00.987654Z" };
const dialect = new PgDialect();
const feed = contentPageSchema.parse({ view: "feed" });
const scope = discoveryScope(feed, null);

test("public cursors retain microseconds, source exhaustion, and query identity", () => {
  const value = { version: 1 as const, scope, snapshot, posts: position, artists: null, boards: null };
  const encoded = writeDiscoveryCursor(value);
  assert.deepEqual(readDiscoveryCursor(encoded, scope), value);
  assert.equal(contentPageSchema.safeParse({ view: "feed", cursor: encoded }).success, true);
  assert.equal(contentPageSchema.safeParse({ cursor: encoded }).success, false);
  assert.equal(contentPageSchema.safeParse({ view: "feed", page: 1 }).success, false);
  assert.equal(contentPageSchema.safeParse({ view: "feed", profileId: "one" }).success, false);
  for (const selection of [{ view: "explore" }, { view: "feed", followed: "true" }, { view: "feed", q: "art" }]) {
    const changedScope = discoveryScope(contentPageSchema.parse(selection), "fan");
    assert.throws(() => readDiscoveryCursor(encoded, changedScope), DiscoveryCursorError);
  }
  assert.equal(discoveryScope(feed, "account-one"), discoveryScope(feed, "account-two"));
  const followed = contentPageSchema.parse({ view: "feed", followed: "true" });
  assert.notEqual(discoveryScope(followed, "account-one"), discoveryScope(followed, "account-two"));
  assert.throws(() => readDiscoveryCursor("garbage", scope), DiscoveryCursorError);
});

test("lookahead cursor uses the last displayed row, never the extra row", () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ id: String(i), cursorTime: snapshot }));
  assert.deepEqual(cursorForWindow(rows, 20), { id: "19", time: snapshot });
  assert.equal(cursorForWindow(rows.slice(0, 20), 20), null);
  assert.equal(cursorForWindow([], 20), null);
});

test("keyset SQL uses an exact timestamp/ID tuple and a fixed snapshot ceiling", () => {
  const result = dialect.sqlToQuery(keysetBoundary(sql`published_at`, sql`id`, snapshot, position)!);
  assert.deepEqual(result.params, [snapshot, position.time, position.id]);
  assert.match(result.sql, /published_at <= \$1::timestamptz/);
  assert.match(result.sql, /\(published_at, id\) < \(\$2::timestamptz, \$3\)/);
  assert.doesNotMatch(result.sql, /offset/i);
  assert.equal(result.params[1], "2026-11-10T09:00:00.987654Z");
});

test("search normalizes username mentions and uses bound native full-text prefix queries", () => {
  assert.deepEqual(searchTerms("  @artist   film "), ["artist", "film"]);
  const needle = "artist'); DROP TABLE stillroom_posts; --";
  const result = dialect.sqlToQuery(textMatch(sql`document`, needle));
  assert.deepEqual(result.params, [needle]);
  assert.doesNotMatch(result.sql, /DROP TABLE/);
  assert.match(result.sql, /to_tsvector\('simple'/);
  assert.match(result.sql, /quote_literal/);
  assert.match(result.sql, /':\*'/);
});

test("category predicates preserve familiar discipline aliases and Other exclusions", () => {
  const music = dialect.sqlToQuery(categoryCondition(sql`discipline`, "Music"));
  assert.match(String(music.params[0]), /musician/);
  assert.match("Singer and songwriter", new RegExp(String(music.params[0]), "i"));
  const other = dialect.sqlToQuery(categoryCondition(sql`discipline`, "Other"));
  assert.match(other.sql, /not/);
  assert.match(String(other.params[0]), /cinema/);
  assert.match(String(other.params[0]), /photographer/);
});
