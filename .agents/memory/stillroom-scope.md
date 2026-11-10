---
name: Stillroom scope
description: User-approved persistence transition and enduring product constraints.
---

The user explicitly approved upgrading the memory-only demo to Replit-managed Clerk and PostgreSQL, with secure persistent uploads. The former prohibition on backend, database, and real authentication no longer applies. Preserve the existing vanilla HTML/CSS/JavaScript SPA and visual identity rather than rebuilding it in React.

**Why:** The user requested a real multi-user foundation, approved “Proceed with Clerk and PostgreSQL,” and required preservation rather than a rewrite. Clerk's React-oriented examples are not permission to replace the existing frontend.

**How to apply:** Use verified identity and stable account IDs for permissions and content ownership. Treat client data as a rendering cache, not durable storage. Keep temporary editor state separate from saved data.

Do not seed fictional users, artists, boards, posts, comments, reposts, or Shelves. Preserve truthful empty states. Private per-Fan follows and private Shelves must not be exposed to other accounts. Reposts reference original content. Explore combines terms and category filters and orders by recency, never likes, public follower counts, or popularity.

**Why:** These were repeated product requirements throughout Stillroom's incremental development; moving to persistence does not authorize changing them.

**How to apply:** Preserve those constraints in both API authorization and the UI. Do not use seeded records to make production screens look populated.

Fans and Artists may comment on public Fan posts. Only the Artist who owns the original Board receives its official-Artist comment badge. Reposting and publishing remain Fan-only.

**Why:** The persistent Comments requirements explicitly allow both roles to participate while retaining the existing publishing restrictions.

**How to apply:** Derive comment authorship, roles, and Board ownership from authenticated IDs and relational records, never request-body claims.

Artist Collections are public curation of Fan Posts from that Artist's own Board, distinct from personal Shelves. Artists highlight and organize original Fan contributions; curation must not turn into original Artist publishing or copied Fan content.

**Why:** The user explicitly requested meaningful Artist curation while retaining Stillroom as a fan-created content platform.

**How to apply:** Keep Artist curation relationships separate from personal Shelf privacy and original post ownership. Preserve Fan attribution and remove unavailable original-post references safely.
