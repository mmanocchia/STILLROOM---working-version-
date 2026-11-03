# Stillroom

Stillroom is an art-focused social platform connecting Fans and Artists across music, film, photography, painting, fashion, and other creative disciplines.

The application preserves its vanilla JavaScript single-page interface while using Clerk, PostgreSQL, and private file storage for real multi-user functionality. No fictional users or sample content are seeded.

## Features

- **Artist Boards:** Artists create and manage their own board; only Fans can publish contributions.
- **Fan posts:** Text, image, and video posts with owner-only editing and deletion.
- **Feed:** Chronological discovery and a private My Artists selection.
- **Explore:** Search and category filters for artists, boards, and posts.
- **My Space:** Personal public or private Shelves that reference existing posts.
- **Profiles:** Fan and Artist profiles with unique usernames and owner-only editing.
- **Reposts and comments:** Original-content attribution and owner-controlled interactions.
- **Authentication:** Clerk registration, sign-in, sign-out, and persistent sessions with Fan/Artist onboarding.

Stillroom does not show likes, public follower counts, or popularity rankings.

## Technology

| Layer | Stack |
| --- | --- |
| Frontend | Vanilla HTML, CSS, and JavaScript with Vite |
| API | Express 5 and TypeScript |
| Authentication | Replit-managed Clerk |
| Database | PostgreSQL and Drizzle ORM |
| Media | Private Replit App Storage |
| Workspace | pnpm monorepo |
| API contract | OpenAPI with generated clients and validation schemas |

## Project structure

```text
artifacts/
  art-social/       # Stillroom web application
  api-server/       # API and authorization
  mockup-sandbox/   # Separate component preview environment
lib/
  db/               # Database schema and connection
  api-spec/         # OpenAPI contract
  api-zod/          # Generated API validation schemas
  api-client-react/ # Generated API client package
```

## Running on Replit

Use the existing managed workflows:

- `artifacts/art-social: web`
- `artifacts/api-server: API Server`

The managed workflows provide the required ports and preview paths. The mockup sandbox is separate from the main application.

Dependencies are managed with pnpm:

```sh
pnpm install
```

Authentication, database access, and storage must be configured through the workspace's managed services and secrets. Never commit credentials or copy secret values into source files. Passwords are handled by Clerk, not by Stillroom's API.

## Validation

```sh
# Frontend JavaScript syntax
pnpm --filter @workspace/art-social run typecheck

# API TypeScript
pnpm --filter @workspace/api-server run typecheck

# API tests
pnpm --filter @workspace/api-server run test

# Regenerate shared API clients and schemas
pnpm --filter @workspace/api-spec run codegen
```

The frontend build requires the artifact's `PORT` and `BASE_PATH` environment:

```sh
pnpm --filter @workspace/art-social run build
```

Do not edit generated API files by hand.

## Data and permissions

- Profiles are linked to verified Clerk user IDs.
- PostgreSQL is the source of truth; frontend collections are rendering caches.
- The server enforces account roles and content ownership.
- Private Shelves, drafts, and artist selections are scoped to the signed-in account.
- Reposts and saved Shelf items reference original posts instead of copying them.
- Uploads use short-lived signed URLs, server-side verification, and private storage.
- Account switching requires a real sign-out and sign-in.

## Development notes

Preserve the existing design, navigation, vanilla client architecture, and Fan/Artist permissions. Do not seed fictional accounts or content.

Schema changes can be applied to the **development database** with:

```sh
pnpm --filter @workspace/db run push
```

Review schema changes before applying them. Development database changes do not automatically publish the application or migrate production.

See [replit.md](replit.md) for operational notes, authentication boundaries, and the pre-production checklist.
