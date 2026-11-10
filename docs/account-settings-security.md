# Account Settings and deletion

Development implementation; not published automatically.

## Identity and credentials

`/settings` is linked from the signed-in Profile. PostgreSQL holds the public
profile and stable Clerk ID. Display usernames remain case-preserving with a
case-insensitive unique key. The server accepts only the current account's
allowed profile fields. Login email, email verification, passwords and recovery
codes go directly to Clerk, never to Stillroom's API, database or logs.

`/recover` uses the installed Clerk JavaScript resource's
`reset_password_email_code` flow. Email-request responses do not disclose account
existence. Passwordless/social accounts retain their provider login; Settings
does not pretend to change a password they do not have. Recent Clerk first-factor
verification is required for sensitive changes and checked again on the server
for account deletion. Missing verification claims fail closed.

Artist portrait and biography edits keep their existing Board representation
consistent. Artist Board names and disciplines remain managed through the Board.
Existing Artist biographies support up to 2,000 characters; Fan biographies
retain their 1,000-character limit.

## Permanent deletion sequence

1. Require an authenticated current user, typed `DELETE`, and explicit Artist
   cascade acknowledgement. The UI also requires a permanence acknowledgement.
2. In one PostgreSQL transaction, lock the account, record a cleanup job, capture
   all affected storage references, remove the profile and cascade its related
   records, and record application-data cleanup. A failure rolls everything back.
3. Block the subject from all normal authenticated APIs, including onboarding.
   A previously signed Clerk JWT must not restore the deleted profile.
4. The leased worker removes the Clerk identity (which invalidates its sessions),
   then purges queued objects. Missing identities/objects count as already removed.
   The raw Clerk ID is erased from the ledger after provider acknowledgement.
5. Preserve media still referenced by surviving users. Remove orphaned Fan media
   when their contributions disappear with an Artist Board. Wait for previously
   issued signed PUT URLs to expire before claiming those paths are clean.
6. Clear each completed object path and retry external failures with backoff.
   Complete only after both authentication and all scheduled file cleanup finish.

`/deletion-status` uses a random, receipt-scoped capability in session storage.
Only its hash is persisted server-side. Status responses contain no identity or
profile data. A retry never creates a new deletion request or targets another
account. A minimal one-way subject hash remains to deny replayed sessions.

The worker runs on server startup, periodic ticks and incoming API requests;
durable leases recover interrupted work. On autoscaled infrastructure, work
resumes when a server is running/wakes. Do not promise a fixed background cleanup
deadline while the service is asleep. A deployment requiring time-bounded cleanup
needs an appropriately running worker/scheduler before publication.

Active-data removal is not a claim of instant erasure from database backups,
storage recovery versions or provider retention systems. No retention period has
been invented; verify the actual deployment/provider policies before making such
claims.

## Development schema and release caveat

The new tables/columns/indexes were verified in development. `drizzle-kit push`
reported a pre-existing `42P07` collision on `stillroom_posts_board_id_unique`
after applying the additive objects. Do not drop that index: curation foreign
keys depend on it.

`lib/db/migrations/20261110_account_settings.sql` is a scoped, additive, rerunnable
alternative for this feature. It does not solve the broader introspection/index
conflict. Production has not been changed; apply an approved migration and
resolve existing deployment API routing independently before publishing.

## Verification

- Run the normal API tests, frontend tests, API typecheck and frontend build.
- The opt-in destructive audit creates **only** new, provenance-marked development
  identities, profiles, relationships and files:
  `node artifacts/api-server/scripts/verify-account-deletion.mjs --allow-isolated-destructive-tests`.
- It verifies real cascade deletion, storage removal, surviving-account data,
  a simulated provider outage, durable retry and idempotence. It compares all
  pre-existing profiles, Boards and posts before/after.
- Backend-created Clerk sessions lack recent first-factor verification. Their
  rejection is a security pass, **not** a successful browser deletion test.
  Real identity verification, verified email delivery, password change and
  recovery still require interactive provider checks when not executed.
- Never run destructive tests against existing users/content or production.
