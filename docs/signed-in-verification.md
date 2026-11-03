# Signed-in cross-account verification

Date: November 3, 2026. Environment: development preview only.

## Scope and identity limitations

The user approved two disposable identities: one Artist and one Fan. All
temporary content was labeled Verification. Existing content was not used for
destructive checks. No deployment was made. A session-isolation fix was added
after the initial verification; details and focused regression evidence are
recorded below.

The browser tester used the supported programmatic Clerk sign-in helper with
overridden login claims. Stillroom onboarding and the app's genuine sign-out /
account-switch control were exercised. The control signed the current identity
out before the helper signed in the other identity. This verifies app state and
role handling, **not normal Clerk password, email verification, or credential
exchange**. The helper output does not establish whether real Clerk user objects
were created.

## Executed checks

| Check | Result and evidence |
| --- | --- |
| Artist and Fan onboarding | Passed through UI. Authenticated user responses identified the expected persisted role and profile after refresh. |
| Account switching | Passed app sign-out/switch control in both directions; restored the correct account with the helper. No identity selection masquerading as authentication. |
| Artist Board | UI create/edit passed; edited values and ownership survived reload. |
| Fan profile | UI biography/interests editing passed and persisted after reload. Artist profile displayed its Board. |
| My Artists | UI add/remove/re-add passed; followed state persisted. |
| Fan posts | UI create/edit passed. A separately created temporary post was deleted through the visible Delete control and inline confirmation. UI showed “Post deleted”; subsequent bootstrap showed no post. |
| Saved drafts | UI save, leave, reload, and reopen passed. Private draft content remained available to its owner. |
| Shelves | UI create/edit, private default, adding a post, and persistence passed. Public visibility was verified from Artist, then restored to private. |
| Shelf privacy | Artist saw “Shelf not available” on the private Shelf route; Artist and guest bootstrap omitted the private Shelf and draft. |
| Follow privacy | Artist bootstrap omitted the Fan-keyed mapping. Guest bootstrap explicitly returned `followedArtistsByFan: {}`. |
| Comments | Fan UI create/edit/delete passed; another retained comment was unchanged by cross-account attempts. |
| Reposts | Create/undo passed and referenced the original post. |
| Real image upload | Browser-generated valid PNG, 79,432 bytes, published and remained after refresh; media GET returned 200 with `image/png`. |
| Real video upload | Browser MediaRecorder WebM, 14,189 bytes, published and persisted. Stored asset was ready with `video/webm`. |
| Seeking | Browser video reached `currentTime=0.5`, `seeking=false`, with duration 1.162 seconds. |
| Range requests | Valid request returned 206 with `bytes 0-99/14189`, 100 bytes; invalid request returned 416 with `bytes */14189`. |
| Private uploads | Private draft PNG owner GET returned 200, 6,068 bytes, `private, no-store`; Artist and guest GET returned 404. Published video guest GET returned 200. |
| File limits | Eight metadata-only upload requests covering unsupported types and profile/Board/post image/video limits returned 400 without creating rejected-upload rows. UI rejected unsupported post/profile/Board types, over-4-MB profile/Board images, and over-25-MB video. The over-10-MiB post-image input displayed its alert without preview/upload, but the browser input-transfer operation timed out after three seconds; this last UI observation is qualified rather than a clean automation pass. |
| Artist publishing | Valid **new** post payload returned 403, “Only Fan accounts can do that”; no post was created. |
| Fan Board creation | Valid Board payload returned 403, “Only Artist accounts can do that”; existing Board values were unchanged. |
| Cross-account writes | Artist attempts against Fan post/comment/draft returned 403 at the role gate. Fan-owned Shelf edit/add attempts returned 404; setPosts returned 403. Attaching Fan private media to Artist profile/Board returned 400. Existing target records remained unchanged. |
| Signed-out writes | Post, comment, draft, Shelf, and upload attempts returned 401. |

No functional failures were observed in the executed checks.

## Session-isolation correction

The completion check identified an uncovered race: post and Board save responses
could bypass the session-generation guard and reapply an old account's bootstrap
after an account switch. The initial browser checks did not exercise delayed
responses and therefore did not establish safety for this case.

Post and Board saves now use the same guarded mutation path as other actions.
All mutation completion handlers check the starting auth generation before
changing state, including success, error, and final cleanup paths. Onboarding
also ignores old-session errors. Session reset clears old pending operations and
private editor state without relying on the old request to finish. The session
listener also immediately renders the loading view before requesting a new
bootstrap, even when an older bootstrap request is still pending. This closes
the separate stale-DOM exposure identified in the final completion check.

Validation:

- `pnpm --filter @workspace/art-social run typecheck` passed.
- `node --test artifacts/art-social/tests/session-isolation.test.mjs` passed
  all eight tests. These run the actual SPA handlers in a lightweight JavaScript
  harness, holding requests until after a simulated auth-generation change and
  asserting the entire new-session state remains unchanged for both successful
  and failed post/Board responses. Normal saves and editor reset are also tested.
  The eighth test uses the actual session listener and renderer with an unresolved
  earlier bootstrap and asserts that the old private DOM disappears immediately,
  before either bootstrap can resolve.
- Frontend workflow restarted cleanly after the source changes.
- A targeted follow-up with the same browser tester confirmed an ordinary Fan
  post save still succeeds and captured a delayed HTTP 200 save response
  containing Fan private data. However, switching the helper identities required
  a document reload; the still-mounted, in-place browser race could not be
  reproduced. Artist state remained isolated after reload and response release,
  but this is **not** claimed as an in-place race pass. The deterministic handler
  tests above provide the delayed-success/error regression coverage.
- The follow-up recreated only the same approved test-owned app profiles, created
  one disposable Board, two posts, one private Shelf, and one draft, then removed
  those exact rows and both profiles. Final exact-ID database counts were zero.
  No further media or provider accounts were created or removed.

## Limits and observations

- Only one Artist and one Fan were approved. Artist-to-Fan post/comment writes
  hit role checks before ownership checks. Same-role Fan-to-Fan ownership
  isolation was **not** tested.
- WebM was tested; MP4 and real mobile-device capture were not tested.
- Ordinary Clerk credential entry, verification emails, and real identity
  provider sign-in remain unverified.
- A transient public/loading shell appeared during auth rehydration; subsequent
  navigation rendered the correct authenticated account.
- Repeated media requests produced server `MaxListenersExceededWarning` messages
  for error and close listeners on a PassThrough stream. Media checks still
  passed, but stream listener cleanup deserves investigation.

## Cleanup

The tester removed only its exact manifested Board, posts, comments, Shelf/link,
draft, follow, and media records. Reposts and previously deleted comments were
already absent. All three exact uploaded storage objects were checked and
returned `exists:false`; finalized upload staging objects had been removed by
the normal completion flow.

A temporary Board/post used to close the UI deletion and role-denial evidence
gaps was also removed with exact identity/ownership guards. The temporary post
was removed through the UI, not merely database cleanup.

Finally, the parent agent deleted the two exact approved disposable Stillroom
profile rows using their recorded IDs plus the Verification display-name guard;
the database returned the Artist and Fan roles. Foreign-key cascades apply only
to those test profiles' dependents. A post-cleanup guest bootstrap contained no
test Boards, posts, or Shelves. No broad data deletion was performed.

No Clerk-directory deletion was attempted: the helper's output did not establish
whether any real Clerk directory users existed. The two app profiles, test
content, and known uploaded objects were removed.
