---
name: Clerk test identity cleanup
description: Safety boundary for cleanup after programmatic Clerk browser tests.
---

The testing helper's requested login email/claims can differ from the email actually stored on the Clerk subject it authenticates. Do not treat the requested test email as verified provider-account provenance, or assume the returned subject is disposable.

**Why:** A provider lookup matched the tested subject IDs but not their requested emails. The helper's opaque login output did not establish whether those provider identities were generated per run or shared. An email-guarded cleanup correctly refused deletion.

**How to apply:** Clean application test records only by exact test-owned IDs with additional identifying guards. Delete provider users only after independent ownership/provenance verification. Never remove a possibly shared testing identity merely because it appeared in a test report; do not expose login tickets or tokens while investigating.

When authorized to test existing development accounts, exact-ID backend sessions are a verified alternative to the email-based browser helper: verify each existing provider user, create a session for that ID, and obtain its normal signed session token. Assert the API restores that same database profile before any test mutation. Revoke only sessions created by the audit, and never log tokens.

**Why:** The browser helper does not guarantee existing-user-only authentication. Clerk's backend session API allowed cross-account API verification without creating identities, changing passwords, or weakening application authentication.

**How to apply:** Keep this opt-in and development-only. Permission to test temporary interactions is not permission to create accounts or delete provider identities. Keep tokens in process memory and track all newly created session and interaction IDs for precise cleanup.
