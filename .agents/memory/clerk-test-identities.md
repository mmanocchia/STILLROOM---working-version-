---
name: Clerk test identity cleanup
description: Safety boundary for cleanup after programmatic Clerk browser tests.
---

The testing helper's requested login email/claims can differ from the email actually stored on the Clerk subject it authenticates. Do not treat the requested test email as verified provider-account provenance, or assume the returned subject is disposable.

**Why:** A provider lookup matched the tested subject IDs but not their requested emails. The helper's opaque login output did not establish whether those provider identities were generated per run or shared. An email-guarded cleanup correctly refused deletion.

**How to apply:** Clean application test records only by exact test-owned IDs with additional identifying guards. Delete provider users only after independent ownership/provenance verification. Never remove a possibly shared testing identity merely because it appeared in a test report; do not expose login tickets or tokens while investigating.
