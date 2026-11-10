---
name: Correlated selection SQL
description: Drizzle strips Column qualifiers inside nested selected SQL on single-table selects.
---
Use explicit qualified SQL identifiers inside correlated SELECT expressions, or compile the query with joins that preserve qualification. Ordinary interpolated Drizzle Column objects can lose their table qualifiers in a single-table selection, including inside nested subqueries.

**Why:** A Shelf cover expression compiled into ambiguous inner `id` references and caused profile and Shelf requests to fail at runtime, despite successful TypeScript checks.

**How to apply:** For correlated selected expressions, inspect the final single-table `.toSQL()` result in a no-network regression test. Verify inner aliases and the outer correlation both remain qualified. A passing SQL-expression-only test is insufficient if the final selection mapper can rewrite it.
