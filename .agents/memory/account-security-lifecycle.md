---
name: Account security lifecycle
description: Permanent-deletion consent, residual JWT protection and honest provider verification tests.
---

Deleting an Artist account must disclose and explicitly confirm that their Board
and its Fan contributions will also be permanently removed.

**Why:** The user explicitly required this cascade, not merely hiding or
anonymizing an Artist account.

**How to apply:** Preserve the separate Artist-specific confirmation in any
future deletion UX or API refactor. Never test deletion against existing users;
use explicitly authorized, isolated identities with verified creation provenance.

Keep a minimal non-reversible security ledger after provider identity removal;
remove raw identity references and completed storage paths, but do not allow
previously issued, still-valid Clerk JWTs to recreate a deleted profile.

**Why:** Provider deletion and local JWT verification are not an atomic operation.
Cleanup must remain retryable and an account must be unusable while it is pending.

**How to apply:** Record cleanup before external deletion, fail closed on missing
recent-authentication claims, and preserve tombstone checks across onboarding and
other authenticated APIs.

Backend-created Clerk test sessions do not establish recent first-factor
verification. A successful direct cleanup audit does not prove the complete
HTTP/browser deletion journey.

**Why:** The provider's signed freshness claims correctly rejected these sessions.

**How to apply:** Report rejection and service-level cleanup tests separately;
never fabricate freshness claims or weaken reverification just to pass tests.
