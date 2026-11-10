import { createHash } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

export const subjectHash = (value: string) => createHash("sha256").update(value).digest("hex");
export class AccountError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function accountLimit(subject: string, action: string, maximum: number, minutes = 1) {
  const window = new Date(Math.floor(Date.now() / (minutes * 60000)) * minutes * 60000);
  const { rows } = await pool.query(
    `INSERT INTO stillroom_account_request_limits(subject_hash,action,"window",count) VALUES($1,$2,$3,1)
     ON CONFLICT(subject_hash,action,"window") DO UPDATE SET count=stillroom_account_request_limits.count+1 RETURNING count`,
    [subjectHash(subject), action, window]);
  if (rows[0].count > maximum) throw new AccountError(429, "Too many attempts. Please wait before trying again.");
}

export async function deletionStatus(receipt: string) {
  const { rows } = await pool.query(`SELECT d.*, (SELECT count(*)::int FROM stillroom_deletion_media m WHERE m.deletion_id=d.id) AS pending_media
    FROM stillroom_account_deletions d WHERE receipt_hash=$1`, [subjectHash(receipt)]);
  if (!rows[0]) throw new AccountError(404, "No deletion request was found for this receipt.");
  const row = rows[0];
  return {
    status: row.status as "pending" | "complete",
    pendingMedia: row.pending_media as number,
    authenticationRemoved: row.authentication_removed as boolean,
    applicationDataRemoved: row.application_data_removed as boolean,
    message: row.status === "complete"
      ? "Your account, active application data and scheduled media cleanup have been removed. Backup and provider retention policies may still apply."
      : "Your account is unavailable. Cleanup is still pending and will retry automatically. Uploaded files may require time for existing upload links to expire.",
  };
}

// This transaction is the only entry to permanent deletion. It records a durable
// job and captures storage paths BEFORE cascades discard media metadata. Any
// failure rolls back the entire operation; no Clerk call occurs in this step.
export async function initiateDeletion(userId: string, receipt: string, artistConfirmed: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`delete:${userId}`]);
    const existing = await client.query("SELECT receipt_hash FROM stillroom_account_deletions WHERE subject_hash=$1", [subjectHash(userId)]);
    if (existing.rows.length) {
      if (existing.rows[0].receipt_hash !== subjectHash(receipt)) throw new AccountError(409, "Deletion is already in progress. Use your saved deletion receipt to check its status.");
      await client.query("COMMIT");
      return;
    }
    const profile = await client.query("SELECT role FROM stillroom_profiles WHERE id=$1 FOR UPDATE", [userId]);
    if (!profile.rows[0]) throw new AccountError(404, "Your profile was not found.");
    if (profile.rows[0].role === "Artist" && !artistConfirmed) {
      throw new AccountError(400, "Confirm that your Artist Board and all Fan contributions to it will be permanently removed.");
    }
    const { rows: [job] } = await client.query(`INSERT INTO stillroom_account_deletions(subject_hash,user_id,receipt_hash)
      VALUES($1,$2,$3) RETURNING id`, [subjectHash(userId), userId, subjectHash(receipt)]);
    const assets = await client.query(`SELECT m.* FROM stillroom_media_assets m
      WHERE m.owner_id=$1 OR m.id IN (
        SELECT p.media_asset_id FROM stillroom_posts p JOIN stillroom_artist_boards b ON b.id=p.board_id WHERE b.owner_id=$1
        UNION SELECT d.media_asset_id FROM stillroom_post_drafts d JOIN stillroom_artist_boards b ON b.id=d.board_id WHERE b.owner_id=$1
      ) ORDER BY m.id FOR UPDATE`, [userId]);
    await client.query("DELETE FROM stillroom_profiles WHERE id=$1", [userId]);
    const paths = new Map<string, Date>();
    for (const asset of assets.rows) {
      // A contribution's media may also be used on another Board or in a draft.
      // Preserve those objects and their surviving Fan-owned metadata.
      if (asset.owner_id !== userId) {
        const refs = await client.query(`SELECT EXISTS(
          SELECT 1 FROM stillroom_posts WHERE media_asset_id=$1
          UNION ALL SELECT 1 FROM stillroom_post_drafts WHERE media_asset_id=$1
          UNION ALL SELECT 1 FROM stillroom_profiles WHERE profile_image_asset_id=$1
          UNION ALL SELECT 1 FROM stillroom_artist_boards WHERE profile_image_asset_id=$1 OR cover_image_asset_id=$1
        ) AS used`, [asset.id]);
        if (refs.rows[0].used) continue;
        await client.query("DELETE FROM stillroom_media_assets WHERE id=$1", [asset.id]);
      }
      const expires = asset.upload_expires_at
        ? new Date(asset.upload_expires_at) : new Date(new Date(asset.created_at).getTime() + 16 * 60000);
      // Never report cleanup complete while a previously issued signed URL can
      // recreate the object. A one-minute clock/issuance margin is included.
      const uploadAfter = new Date(expires.getTime() + 60000);
      const currentAfter = asset.status === "pending" ? uploadAfter : new Date(0);
      for (const [path, after] of [[asset.object_path, currentAfter], [asset.upload_object_path, uploadAfter]] as const) {
        if (path && (!paths.has(path) || paths.get(path)! < after)) paths.set(path, after);
      }
      if (asset.status === "pending") paths.set(`/objects/assets/${asset.id}`, new Date(0));
    }
    for (const [path, after] of paths) {
      await client.query("INSERT INTO stillroom_deletion_media(deletion_id,object_path,not_before) VALUES($1,$2,$3)", [job.id, path, after]);
    }
    await client.query("UPDATE stillroom_account_deletions SET application_data_removed=true WHERE id=$1", [job.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export interface CleanupDependencies {
  removeIdentity(userId: string): Promise<void>;
  removeObject(path: string): Promise<void>;
}
const storage = new ObjectStorageService();
const defaultDependencies: CleanupDependencies = {
  async removeIdentity(userId) {
    try { await clerkClient.users.deleteUser(userId); }
    catch (error) {
      // A retry after a lost successful response must accept an absent user.
      if ((error as { status?: number }).status !== 404) throw error;
    }
  },
  async removeObject(path) {
    try {
      const file = await storage.getObjectEntityFile(path);
      await file.delete({ ignoreNotFound: true });
    } catch (error) { if (!(error instanceof ObjectNotFoundError)) throw error; }
  },
};

// Multi-instance safe lease; a crashed process is retried by another process.
// Identity and object deletion are idempotent, so a lost response is harmless.
export async function runDeletionBatch(deps: CleanupDependencies = defaultDependencies, onlySubjectHash: string | null = null) {
  const { rows } = await pool.query(`UPDATE stillroom_account_deletions SET lease_until=now()+interval '3 minutes', attempts=attempts+1
    WHERE id IN (SELECT id FROM stillroom_account_deletions WHERE status='pending' AND next_attempt_at<=now()
      AND (lease_until IS NULL OR lease_until<now()) AND ($1::text IS NULL OR subject_hash=$1)
      ORDER BY next_attempt_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *`, [onlySubjectHash]);
  for (const job of rows) {
    try {
      if (!job.application_data_removed) throw new Error("APPLICATION_CLEANUP_NOT_RECORDED");
      if (!job.authentication_removed) {
        if (!job.user_id) throw new Error("IDENTITY_REFERENCE_MISSING");
        await deps.removeIdentity(job.user_id);
        // Erase the last raw identity reference as soon as Clerk acknowledges.
        await pool.query("UPDATE stillroom_account_deletions SET authentication_removed=true,user_id=NULL WHERE id=$1", [job.id]);
      }
      const media = await pool.query("SELECT id,object_path FROM stillroom_deletion_media WHERE deletion_id=$1 AND not_before<=now()", [job.id]);
      for (const row of media.rows) {
        await deps.removeObject(row.object_path);
        await pool.query("DELETE FROM stillroom_deletion_media WHERE id=$1", [row.id]);
      }
      await pool.query(`UPDATE stillroom_account_deletions SET
        status=CASE WHEN NOT EXISTS(SELECT 1 FROM stillroom_deletion_media WHERE deletion_id=$1) THEN 'complete' ELSE 'pending' END,
        completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM stillroom_deletion_media WHERE deletion_id=$1) THEN now() ELSE NULL END,
        lease_until=NULL,last_error_code=NULL,next_attempt_at=now()+interval '1 minute' WHERE id=$1`, [job.id]);
    } catch {
      // Do not persist provider errors, object names, credentials or user info.
      await pool.query(`UPDATE stillroom_account_deletions SET lease_until=NULL,last_error_code='EXTERNAL_CLEANUP_RETRY',
        next_attempt_at=now()+interval '1 minute' * LEAST(60,POWER(2,LEAST(attempts,6))) WHERE id=$1`, [job.id]);
      logger.warn({ deletionId: job.id }, "Account cleanup remains pending; scheduled for retry");
    }
  }
  await pool.query(`DELETE FROM stillroom_account_request_limits WHERE "window"<now()-interval '1 day'`);
}

let running = false;
let lastKick = 0;
export function kickDeletionWorker(force = false) {
  if (running || (!force && Date.now() - lastKick < 60000)) return;
  lastKick = Date.now();
  running = true;
  void runDeletionBatch().catch(() => logger.error("Account cleanup worker unavailable; durable jobs will retry"))
    .finally(() => { running = false; });
}
export function startDeletionWorker() {
  kickDeletionWorker(true);
  const timer = setInterval(kickDeletionWorker, 60000);
  timer.unref();
}
