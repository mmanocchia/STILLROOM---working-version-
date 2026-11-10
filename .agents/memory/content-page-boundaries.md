---
name: Content page boundaries
description: Preserve bounded post snapshots and route context when changing reads or mutations.
---

Keep public post reads bounded and scoped to the destination view. Mutations that return a replacement snapshot must use the same content scope as reads; page navigation must replace the post page rather than accumulate the entire catalogue.

**Why:** A globally limited snapshot can make older Boards, direct post links, profiles, and saved posts appear empty even when their records exist. An unbounded mutation response can silently undo the memory limits of paginated reads.

**How to apply:** Preserve Board, profile, post, Shelf, private-follow, and search context throughout requests and after navigation. Treat initial identity hydration specially when an own-profile route has no resolved profile yet. Invalidate older background refreshes before applying mutation results, and keep automatic refreshes from replacing active editors.
