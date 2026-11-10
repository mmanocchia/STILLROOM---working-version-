import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { usernameSchema } from "../lib/profileValidation";
import { AccountError, accountLimit, deletionStatus, initiateDeletion, kickDeletionWorker, subjectHash } from "../lib/accountDeletion";

const router: IRouter = Router();
const receiptSchema = z.object({ receipt: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const accountInformationSchema = z.object({
  name: z.string().trim().min(1, "Enter your display name.").max(100),
  username: usernameSchema,
  biography: z.string().trim().max(2000, "Biography must be 2,000 characters or fewer."),
  profileImageAssetId: z.string().uuid().nullable(),
}).strict();
export const accountDeletionSchema = receiptSchema.extend({
  confirmation: z.literal("DELETE"),
  artistCascadeConfirmed: z.boolean(),
}).strict();

async function settings(id: string) {
  const { rows: [row] } = await pool.query(`SELECT p.*,b.biography AS artist_biography,
    COALESCE(b.profile_image_asset_id,p.profile_image_asset_id) AS effective_image_id,m.status AS image_status
    FROM stillroom_profiles p LEFT JOIN stillroom_artist_boards b ON b.owner_id=p.id AND p.role='Artist'
    LEFT JOIN stillroom_media_assets m ON m.id=COALESCE(b.profile_image_asset_id,p.profile_image_asset_id) WHERE p.id=$1`, [id]);
  if (!row) throw new AccountError(404, "Your profile was not found.");
  return {
    profile: { id: row.id, role: row.role, name: row.display_name, username: row.username, biography: row.artist_biography ?? row.biography,
      interests: row.interests, profileImageAssetId: row.effective_image_id,
      profileImage: row.image_status === "ready" ? `/api/media/${row.effective_image_id}` : "", createdAt: row.created_at },
    privacy: {
      publicFields: ["Display name", "Username", "Profile photo", "Biography", "Artist Board and its contributions", "Posts, comments, reposts and public Shelves"],
      deletionExplanation: "Deletion removes your active profile and owned content. Deleting an Artist also removes their Board and its Fan contributions. File cleanup and Clerk removal may be pending and retry automatically. Backup and provider retention policies may apply; immediate erasure from backups is not guaranteed. A minimal, one-way security receipt is retained to prevent deleted sessions from restoring the account and to track cleanup; it does not contain your profile, email or content.",
    },
    deletion: null,
  };
}

// Register these before the deleted-account guard so the opaque receipt can
// report pending/completed cleanup after Clerk has removed the signed-in user.
router.post(["/account/deletion/status", "/account/deletion/retry"], async (req, res, next) => {
  try {
    const parsed = receiptSchema.safeParse(req.body);
    if (!parsed.success) throw new AccountError(400, "A valid deletion receipt is required.");
    const result = await deletionStatus(parsed.data.receipt);
    await accountLimit(parsed.data.receipt, "deletion-status", 40);
    if (req.path.endsWith("/retry")) {
      await accountLimit(parsed.data.receipt, "deletion-retry", 3);
      await pool.query("UPDATE stillroom_account_deletions SET next_attempt_at=now() WHERE receipt_hash=$1 AND status='pending'", [subjectHash(parsed.data.receipt)]);
      kickDeletionWorker(true);
    }
    res.status(req.path.endsWith("/retry") ? 202 : 200).json(result);
  } catch (error) { next(error); }
});

// Applies to every API, including profile onboarding and uploads. A cached
// Clerk JWT cannot recreate a profile or keep using a partially deleted one.
router.use(async (req, _res, next) => {
  try {
    // Also resume durable work when an autoscaled server wakes for a request.
    kickDeletionWorker();
    const id = getAuth(req).userId;
    if (id) {
      const { rows } = await pool.query("SELECT 1 FROM stillroom_account_deletions WHERE subject_hash=$1", [subjectHash(id)]);
      if (rows.length && req.path !== "/account/deletion") throw new AccountError(403, "This account is being deleted and cannot be used. Sign out to continue browsing.", "ACCOUNT_DELETION_PENDING");
    }
    next();
  } catch (error) { next(error); }
});
router.use("/account", (req, _res, next) => {
  if (!getAuth(req).userId) return next(new AccountError(401, "Sign in to manage your account."));
  next();
});
router.get("/account/settings", async (req, res, next) => {
  try { res.json(await settings(getAuth(req).userId!)); } catch (error) { next(error); }
});
router.get("/account/username", async (req, res, next) => {
  try {
    const id = getAuth(req).userId!;
    await accountLimit(id, "username-availability", 40);
    const parsed = usernameSchema.safeParse(req.query.username);
    if (!parsed.success) { res.json({ valid: false, available: false }); return; }
    const found = await pool.query("SELECT 1 FROM stillroom_profiles WHERE username_key=$1 AND id<>$2", [parsed.data.toLowerCase(), id]);
    res.json({ valid: true, available: !found.rows.length });
  } catch (error) { next(error); }
});
router.patch("/account/settings", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = getAuth(req).userId!;
    await accountLimit(id, "profile-update", 15);
    const parsed = accountInformationSchema.safeParse(req.body);
    if (!parsed.success) throw new AccountError(400, parsed.error.issues[0]?.message || "Check your profile information.");
    const input = parsed.data;
    await client.query("BEGIN");
    const actor = await client.query("SELECT id,role FROM stillroom_profiles WHERE id=$1 FOR UPDATE", [id]);
    if (actor.rows[0]?.role === "Fan" && input.biography.length > 1000) throw new AccountError(400, "Fan biographies must be 1,000 characters or fewer.");
    if (actor.rows[0]?.role === "Artist" && !input.biography) {
      const board = await client.query("SELECT id FROM stillroom_artist_boards WHERE owner_id=$1", [id]);
      if (board.rows.length) throw new AccountError(400, "Your Artist Board needs a biography. Add one before saving.");
    }
    if (input.profileImageAssetId) {
      const media = await client.query(`SELECT id FROM stillroom_media_assets WHERE id=$1 AND owner_id=$2
        AND status='ready' AND content_type IN ('image/png','image/jpeg','image/webp') AND size<=4194304 FOR SHARE`, [input.profileImageAssetId, id]);
      if (!media.rows.length) throw new AccountError(400, "Choose your own completed profile image upload (JPG, PNG or WebP, up to 4 MB).");
    }
    const updated = await client.query(`UPDATE stillroom_profiles SET display_name=$2,username=$3,username_key=$4,biography=$5,
      profile_image_asset_id=$6,updated_at=now() WHERE id=$1 RETURNING role`,
    [id, input.name, input.username, input.username.toLowerCase(), input.biography, input.profileImageAssetId]);
    if (!updated.rows.length) throw new AccountError(404, "Your profile was not found.");
    // Artist profiles already derive their portrait/bio from their own Board.
    // Keep those existing representations consistent, without changing role,
    // board ID, artistic discipline, title, cover or any contributions.
    if (updated.rows[0].role === "Artist") await client.query(`UPDATE stillroom_artist_boards SET
      profile_image_asset_id=$2,biography=$3,updated_at=now() WHERE owner_id=$1`, [id, input.profileImageAssetId, input.biography]);
    await client.query("COMMIT");
    res.json(await settings(id));
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") next(new AccountError(409, "That username is already taken. Choose another."));
    else next(error);
  } finally { client.release(); }
});
router.post("/account/deletion", async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const parsed = accountDeletionSchema.safeParse(req.body);
    if (!parsed.success) throw new AccountError(400, "Type DELETE and confirm the permanent deletion.");
    if (!auth.has({ reverification: { level: "first_factor", afterMinutes: 5 } })) {
      throw new AccountError(403, "Verify your identity within the last five minutes before deleting your account.", "REVERIFICATION_REQUIRED");
    }
    await accountLimit(auth.userId!, "deletion-request", 5, 60);
    await initiateDeletion(auth.userId!, parsed.data.receipt, parsed.data.artistCascadeConfirmed);
    res.status(202).json(await deletionStatus(parsed.data.receipt));
    kickDeletionWorker(true);
  } catch (error) { next(error); }
});
export default router;
