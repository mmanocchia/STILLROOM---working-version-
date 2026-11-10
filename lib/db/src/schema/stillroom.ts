import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const profiles = pgTable(
  "stillroom_profiles",
  {
    id: text("id").primaryKey(),
    role: text("role").notNull(),
    displayName: text("display_name").notNull(),
    username: text("username").notNull(),
    usernameKey: text("username_key").notNull(),
    biography: text("biography").notNull().default(""),
    interests: text("interests").notNull().default(""),
    profileImageAssetId: uuid("profile_image_asset_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("stillroom_profiles_username_key").on(table.usernameKey),
    index("stillroom_profiles_role_created_id_idx").on(table.role, table.createdAt, table.id),
    index("stillroom_profiles_discovery_search_idx").using("gin",
      sql`to_tsvector('simple', (${table.displayName} || ' ' || ${table.username} || ' ' || ${table.biography}))`),
  ],
);

export const artistBoards = pgTable(
  "stillroom_artist_boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    artistName: text("artist_name").notNull(),
    discipline: text("discipline").notNull(),
    biography: text("biography").notNull(),
    profileImageAssetId: uuid("profile_image_asset_id"),
    coverImageAssetId: uuid("cover_image_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    creativeDescription: text("creative_description").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("stillroom_artist_boards_owner_unique").on(table.ownerId),
    index("stillroom_artist_boards_created_at_idx").on(table.createdAt),
    index("stillroom_artist_boards_created_id_idx").on(table.createdAt, table.id),
    index("stillroom_artist_boards_discovery_search_idx").using("gin",
      sql`to_tsvector('simple', (${table.artistName} || ' ' || ${table.discipline} || ' ' || ${table.biography}))`),
  ],
);

export const mediaAssets = pgTable(
  "stillroom_media_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull().unique(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (table) => [index("stillroom_media_assets_owner_idx").on(table.ownerId)],
);

export const posts = pgTable(
  "stillroom_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => artistBoards.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    content: text("content").notNull().default(""),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("stillroom_posts_board_id_unique").on(table.boardId, table.id),
    index("stillroom_posts_board_published_idx").on(
      table.boardId,
      table.publishedAt,
    ),
    index("stillroom_posts_author_published_idx").on(
      table.authorId,
      table.publishedAt,
    ),
    index("stillroom_posts_published_id_idx").on(table.publishedAt, table.id),
    index("stillroom_posts_board_published_id_idx").on(table.boardId, table.publishedAt, table.id),
    index("stillroom_posts_discovery_search_idx").using("gin", sql`to_tsvector('simple', ${table.content})`),
  ],
);

export const reposts = pgTable(
  "stillroom_reposts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    repostedAt: timestamp("reposted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stillroom_reposts_user_post_unique").on(
      table.userId,
      table.postId,
    ),
    index("stillroom_reposts_user_time_idx").on(table.userId, table.repostedAt),
    index("stillroom_reposts_time_id_idx").on(table.repostedAt, table.id),
    index("stillroom_reposts_post_idx").on(table.postId),
  ],
);

export const postDrafts = pgTable(
  "stillroom_post_drafts",
  {
    key: text("key").primaryKey(),
    authorId: text("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").notNull().references(() => artistBoards.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    content: text("content").notNull().default(""),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (table) => [index("stillroom_post_drafts_author_idx").on(table.authorId)],
);

export const comments = pgTable(
  "stillroom_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("stillroom_comments_post_time_idx").on(table.postId, table.createdAt),
    index("stillroom_comments_author_idx").on(table.authorId),
    index("stillroom_comments_post_time_id_idx").on(table.postId, table.createdAt, table.id),
  ],
);

export const follows = pgTable(
  "stillroom_follows",
  {
    fanId: text("fan_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    artistId: text("artist_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.fanId, table.artistId] }),
    index("stillroom_follows_artist_idx").on(table.artistId),
  ],
);

export const shelves = pgTable(
  "stillroom_shelves",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility").notNull().default("private"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("stillroom_shelves_owner_idx").on(table.ownerId),
    index("stillroom_shelves_owner_time_id_idx").on(table.ownerId, table.createdAt, table.id),
    index("stillroom_shelves_visibility_idx").on(table.visibility),
  ],
);

export const shelfPosts = pgTable(
  "stillroom_shelf_posts",
  {
    shelfId: uuid("shelf_id")
      .notNull()
      .references(() => shelves.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    addedAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.shelfId, table.postId] }),
    index("stillroom_shelf_posts_post_idx").on(table.postId),
    index("stillroom_shelf_posts_shelf_time_idx").on(table.shelfId, table.addedAt, table.postId),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type ArtistBoard = typeof artistBoards.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Repost = typeof reposts.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Shelf = typeof shelves.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
