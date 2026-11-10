import assert from "node:assert/strict";
import test from "node:test";
import { contentPageSchema, pageWindow, PAGE_SIZE } from "../src/lib/contentPage.ts";
import { allowedUpload, hasMediaSignature } from "../src/lib/mediaValidation.ts";

test("public content pages have bounded, validated query inputs", () => {
  assert.equal(contentPageSchema.parse({}).page, 0);
  assert.equal(contentPageSchema.parse({ page: "2", q: "  film  " }).q, "film");
  for (const page of ["-1", "1.5", "NaN", "50001"]) {
    assert.equal(contentPageSchema.safeParse({ page }).success, false);
  }
  assert.equal(contentPageSchema.safeParse({ boardId: "invalid" }).success, false);
  assert.equal(contentPageSchema.safeParse({ category: "Popularity" }).success, false);
  assert.equal(contentPageSchema.safeParse({ followed: "false" }).success, false);
});

test("lookahead pages return at most twenty rows and report a next page", () => {
  const records = Array.from({ length: PAGE_SIZE + 1 }, (_, id) => ({ id }));
  const result = pageWindow(records, 3);
  assert.equal(result.rows.length, 20);
  assert.deepEqual(result.pagination, { page: 3, pageSize: 20, hasMore: true });
  assert.equal(pageWindow(records.slice(0, 20), 0).pagination.hasMore, false);
  assert.deepEqual(pageWindow([], 0).rows, []);
});

test("upload type and size limits are enforced for each purpose", () => {
  assert.equal(allowedUpload("post", "image/jpeg", 10 * 1024 * 1024), true);
  assert.equal(allowedUpload("post", "video/mp4", 25 * 1024 * 1024), true);
  assert.equal(allowedUpload("post", "video/mp4", 25 * 1024 * 1024 + 1), false);
  assert.equal(allowedUpload("post", "image/png", 10 * 1024 * 1024 + 1), false);
  assert.equal(allowedUpload("board", "image/jpeg", 4 * 1024 * 1024 + 1), false);
  assert.equal(allowedUpload("profile", "video/mp4", 10), false);
  assert.equal(allowedUpload("post", "text/html", 10), false);
  for (const size of [0, -1, 0.5, NaN]) assert.equal(allowedUpload("post", "image/png", size), false);
});

test("declared media types must have a supported binary signature", () => {
  const signatures = [
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff])],
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ["image/gif", Buffer.from("GIF89a")],
    ["image/webp", Buffer.from("RIFF0000WEBP")],
    ["video/mp4", Buffer.from("0000ftypisom")],
    ["video/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3])],
  ] as const;
  for (const [type, bytes] of signatures) {
    assert.equal(hasMediaSignature(bytes, type), true);
    assert.equal(hasMediaSignature(Buffer.from("<html>not media</html>"), type), false);
    assert.equal(hasMediaSignature(Buffer.alloc(0), type), false);
  }
  assert.equal(hasMediaSignature(Buffer.from("anything"), "text/html"), false);
});
