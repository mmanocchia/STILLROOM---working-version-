import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Not linked by FK to profiles: the cleanup ledger must survive profile erasure.
export const accountDeletions = pgTable("stillroom_account_deletions", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectHash: text("subject_hash").notNull().unique(),
  userId: text("user_id"),
  receiptHash: text("receipt_hash").notNull().unique(),
  applicationDataRemoved: boolean("application_data_removed").notNull().default(false),
  authenticationRemoved: boolean("authentication_removed").notNull().default(false),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("stillroom_deletion_due_idx").on(t.status, t.nextAttemptAt)]);

export const deletionMedia = pgTable("stillroom_deletion_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  deletionId: uuid("deletion_id").notNull().references(() => accountDeletions.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull(),
  notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("stillroom_deletion_media_job_idx").on(t.deletionId)]);

export const accountRequestLimits = pgTable("stillroom_account_request_limits", {
  subjectHash: text("subject_hash").notNull(),
  action: text("action").notNull(),
  window: timestamp("window", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(1),
}, (t) => [primaryKey({ columns: [t.subjectHash, t.action, t.window] })]);
