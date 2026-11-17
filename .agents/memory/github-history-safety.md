---
name: GitHub history safety
description: Safe publishing boundaries for Stillroom's public GitHub repository.
---

For public GitHub updates, publish the sanitized `main` branch explicitly. Do not use `--all` or `--mirror`, because local Replit helper and recovery refs may retain historical metadata. Keep the published remote branch as an ancestor; do not rewrite remote history.

**Why:** The user required preserving published commits and cleaning only the GitHub-bound history. Replit-managed local refs and recovery bundles can retain the pre-cleanup objects without affecting an explicit `main` push.

**How to apply:** Before pushing, confirm the remote `main` is an ancestor of local `main`, scan the commits reachable from `main`, and push only that branch. Review helper refs separately before publishing them.
