---
name: Schema tooling pitfalls
description: Non-obvious Drizzle composite-FK ordering and Orval barrel naming behavior.
---
Drizzle push can attempt a composite foreign key before creating a new referenced unique index. Inspect the failure and actual development constraints before retrying; ensure the referenced uniqueness exists before adding the dependent foreign key.

**Why:** Adding related curation tables initially failed with PostgreSQL 42830 despite the referenced unique index being declared in the schema. Creating the declared prerequisite indexes in development first allowed the remaining additive schema push to complete without deleting data.

**How to apply:** Check ordering when adding composite relationships. Keep schema source and development constraints aligned. Production schema changes still belong to Replit's reviewed Publish flow, never startup-time DDL or custom production mutation scripts.

Orval can name both a path-parameter Zod validator and a query-parameter TypeScript type `<Operation>Params` when an operation has both parameter kinds.

**Why:** Re-exporting both generated modules with wildcard barrel exports causes TS2308, even though generation itself succeeds.

**How to apply:** Explicitly disambiguate the public barrel export and, when needed, give the query type a distinct alias. Do not hand-edit generated code.
