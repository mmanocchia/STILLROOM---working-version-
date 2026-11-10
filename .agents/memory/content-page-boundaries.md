---
name: Content page boundaries
description: Preserve bounded post snapshots and route context when changing reads or mutations.
---

Keep public post reads bounded and scoped to the destination view. Mutations that return a replacement snapshot must use the same content scope as reads. Feed and Explore can append cursor pages into a bounded rolling window; other page-based views replace their snapshot rather than accumulate the entire catalogue.

**Why:** A globally limited snapshot can make older Boards, direct post links, profiles, and saved posts appear empty even when their records exist. An unbounded mutation response can silently undo the memory limits of paginated reads. Cursor positions must retain native PostgreSQL timestamp precision: converting through JavaScript Date loses microseconds and can skip rows sharing a millisecond.

**How to apply:** Preserve Board, profile, post, Shelf, private-follow, and search context throughout requests and after navigation. Scope cursors to the query and, for private follows, the authenticated viewer. Keep a stable timestamp/ID boundary and snapshot ceiling. Restart public pagination after mutations or filter changes. If the route changes during a mutation, refresh the new view instead of applying the old view's snapshot. Treat initial identity hydration specially when an own-profile route has no resolved profile yet. Invalidate older background refreshes before applying mutation results, and keep automatic refreshes from replacing active editors or reordering an accumulated window.
