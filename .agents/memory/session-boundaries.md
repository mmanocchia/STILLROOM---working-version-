---
name: Async session boundaries
description: Why late async completions must be inert across account switches.
---

Treat the authenticated session as the lifetime of every asynchronous UI
operation, not just network data refreshes. After the session changes, old
success, error, and final cleanup handlers must not mutate the next account's
editors or pending-operation state.

**Why:** A late save can return a full account-specific snapshot containing
private Shelves and drafts. Guarding background session synchronization alone
does not protect other paths that accept the same snapshot. Even when snapshot
application is rejected, an old completion handler can still overwrite a new
account's editor or busy flags.

**How to apply:** Keep mutations on the guarded snapshot path, capture the
session generation at operation start, and ignore completions after a change.
Clear pending private UI state when switching sessions rather than waiting for
old requests. Test delayed successes and failures, with the next account already
loaded and editing.

Immediately render a non-private loading view on session changes, even when
joining an already pending data request.

**Why:** Clearing the state object does not erase the old DOM. A stalled earlier
request can otherwise leave private content visible after the identity changes.

**How to apply:** Replace the rendered account view synchronously in the session
listener, before awaiting or joining any request; test with an unresolved prior
request and assert the old private DOM is already gone.
