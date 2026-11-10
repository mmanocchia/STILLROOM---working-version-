import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { artistBoards, posts } from "./stillroom";

// Composite FKs enforce that every curated original really belongs to this Board.
export const featuredPosts = pgTable("stillroom_featured_posts", {
  boardId: uuid("board_id").notNull().references(() => artistBoards.id, { onDelete: "cascade" }),
  postId: uuid("post_id").notNull(),
  position: integer("position").notNull(),
}, (t) => [
  primaryKey({ columns: [t.boardId, t.postId] }),
  uniqueIndex("stillroom_featured_board_position_unique").on(t.boardId, t.position),
  check("stillroom_featured_position_check", sql`${t.position} >= 0 AND ${t.position} < 5`),
  foreignKey({ columns: [t.boardId, t.postId], foreignColumns: [posts.boardId, posts.id] }).onDelete("cascade"),
  index("stillroom_featured_post_idx").on(t.postId),
]);

export const artistCollections = pgTable("stillroom_artist_collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id").notNull().references(() => artistBoards.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("stillroom_collections_board_id_unique").on(t.boardId, t.id),
  index("stillroom_collections_board_position_idx").on(t.boardId, t.position, t.id),
  check("stillroom_collections_title_check", sql`length(trim(${t.title})) BETWEEN 1 AND 100`),
  check("stillroom_collections_position_check", sql`${t.position} >= 0`),
]);

export const artistCollectionPosts = pgTable("stillroom_artist_collection_posts", {
  boardId: uuid("board_id").notNull(),
  collectionId: uuid("collection_id").notNull(),
  postId: uuid("post_id").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.collectionId, t.postId] }),
  foreignKey({ columns: [t.boardId, t.collectionId], foreignColumns: [artistCollections.boardId, artistCollections.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.boardId, t.postId], foreignColumns: [posts.boardId, posts.id] }).onDelete("cascade"),
  index("stillroom_collection_posts_post_idx").on(t.postId),
  index("stillroom_collection_posts_page_idx").on(t.collectionId, t.addedAt, t.postId),
]);
