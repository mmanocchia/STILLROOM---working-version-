import test from "node:test";
import assert from "node:assert/strict";
import { requestBodyError } from "../src/lib/requestBodyError.ts";

test("malformed JSON returns a client error without exposing submitted input", () => {
  const result = requestBodyError({
    type: "entity.parse.failed", status: 400,
    message: "Unexpected token in private submitted data",
    body: "private submitted data",
  });
  assert.deepEqual(result, { status: 400, message: "The request body must contain valid JSON." });
  assert.doesNotMatch(JSON.stringify(result), /private submitted data/);
});

test("oversized, compressed and incomplete requests have safe explicit client errors", () => {
  for (const type of ["entity.too.large", "parameters.too.many"]) {
    assert.equal(requestBodyError({ type })?.status, 413);
  }
  for (const type of ["encoding.unsupported", "charset.unsupported"]) {
    assert.equal(requestBodyError({ type })?.status, 415);
  }
  for (const type of ["request.aborted", "request.size.invalid"]) {
    assert.equal(requestBodyError({ type })?.status, 400);
  }
});

test("unrecognized failures remain on the normal server exception path", () => {
  for (const value of [null, undefined, "", 400, {}, new Error("Database unavailable"),
    { type: "unrecognized", status: 400 }]) {
    assert.equal(requestBodyError(value), null);
  }
});
