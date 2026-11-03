import assert from "node:assert/strict";
import test from "node:test";
import { createProfileSchema, changeUsernameSchema } from "../src/lib/profileValidation.ts";

test("onboarding accepts each public account role and normalizes the username", () => {
  for (const role of ["Fan", "Artist"]) {
    const profile = createProfileSchema.parse({ role, name: " Test ", username: " @tester " });
    assert.equal(profile.name, "Test");
    assert.equal(profile.username, "tester");
    assert.equal(profile.role, role);
  }
});

test("onboarding rejects missing and whitespace-only usernames, including an @ prefix", () => {
  for (const username of ["", " ", "@", " @   ", undefined]) {
    assert.equal(createProfileSchema.safeParse({ role: "Fan", name: "Test", username }).success, false);
    assert.equal(changeUsernameSchema.safeParse({ username }).success, false);
  }
});

test("onboarding rejects invalid roles, blank names, and overlong usernames", () => {
  assert.equal(createProfileSchema.safeParse({ role: "admin", name: "Test", username: "test" }).success, false);
  assert.equal(createProfileSchema.safeParse({ role: "Fan", name: " ", username: "test" }).success, false);
  assert.equal(changeUsernameSchema.safeParse({ username: "x".repeat(33) }).success, false);
});

test("identity, credentials and role changes cannot be supplied as profile fields", () => {
  assert.equal(createProfileSchema.safeParse({ role: "Fan", name: "Test", username: "test", id: "someone-else" }).success, false);
  assert.equal(createProfileSchema.safeParse({ role: "Fan", name: "Test", username: "test", password: "not-stored" }).success, false);
  assert.equal(changeUsernameSchema.safeParse({ username: "test", role: "Artist" }).success, false);
});
