# Stillroom

An art-focused social platform, with a preserved vanilla JavaScript single-page client and a persistent multi-user foundation.

## Run & Operate

Use the existing managed artifact workflows; they inject the correct ports and preview paths:
- `artifacts/art-social: web` — Vite frontend.
- `artifacts/api-server: API Server` — Express API, built with esbuild.
- The mockup sandbox is separate from the production application.

Validation commands:
- `pnpm --filter @workspace/api-spec run codegen` — regenerate OpenAPI client/types/Zod schemas and typecheck shared libraries.
- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/art-social run typecheck`
- `pnpm --filter @workspace/db run push` — apply schema changes to development only.
- `pnpm --filter @workspace/art-social run build` — requires the artifact's `PORT` and `BASE_PATH` build environment.

## Stack & Source Map

- Client: Vite, vanilla HTML/CSS/JavaScript in `artifacts/art-social/src`.
- `main.js` owns existing routing, rendering, and transient editor state.
- `api.js` owns same-origin API requests and the upload handshake.
- `clerk.js` owns managed Clerk initialization and themed UI.
- Server: Express 5/TypeScript in `artifacts/api-server/src`.
- `routes/auth.ts` handles authenticated profile onboarding.
- `routes/social.ts` handles authorized data snapshots and social mutations.
- `routes/media.ts` handles upload authorization, verification, and media streaming.
- Database: managed PostgreSQL + Drizzle; source schema is `lib/db/src/schema/stillroom.ts`.
- API contract: `lib/api-spec/openapi.yaml`; generated files must not be hand-edited.

## Data & Security Boundaries

Clerk verifies identity; the server maps its subject ID to a Stillroom profile. PostgreSQL stores role, profile, board, post, private draft, follow, Shelf, comment, repost, and media-reference records. Client arrays are rendering caches, not the source of truth.

All mutations require a verified session. The server independently checks stored role and ownership. Reposts and Shelf items reference original posts; foreign keys cascade dependent records when originals are deleted. Bootstrap exposes public content plus only the signed-in member's private follows, Shelves, and saved drafts.

Files upload directly to private App Storage with short-lived signed URLs. The server validates the uploaded object's ownership, size, and declared content type, then copies the verified generation to a separate immutable object. Media is served by asset ID, never by a client-supplied storage path. Video byte-range requests are supported. Unreferenced uploads are visible only to their owner.

Do not read or print secret values. Clerk/storage configuration is managed by Replit. Passwords never pass through the application API.

## Clerk / Routing Notes

The root/Feed remains public. New authenticated identities complete Stillroom profile onboarding before account-specific actions.

Account switching is a genuine sign-out/sign-in, not selecting another public profile. A token refresh must not reset an in-progress editor.

Session changes invalidate outstanding client mutations before their responses can rehydrate private data. Clear account-specific drafts/editors when identities change. Clerk sign-out can reload the document; its explicit redirect destination and one-time signed-out notice must survive that reload.

Clerk's vanilla SDK requires its official UI bundle in addition to the session SDK. Keep the host-derived publishable key and automatically supplied proxy environment wiring compatible with managed production domains. Do not add production-only client gates or hardcode a deployment domain.

## Before Production Release

Development schema changes do not mean production has been published. Confirm production configuration through Replit's publishing flow.

Run authenticated cross-account tests with approved disposable test identities: refresh persistence, Fan-only publishing, owner-only edits, private Shelves/drafts, account switching, and real device uploads. Remove test data afterward. Guest navigation/auth-form checks do not prove those protected journeys.

Further hardening should cover request/upload rate limits, content inspection, stale-upload cleanup, feed pagination, and account-deletion lifecycle handling.
