import { sql } from "drizzle-orm";

// Explicit inner/outer qualifiers survive Drizzle's single-table select mapper.
export const collectionSummaryFields = {
  postCount: sql<number>`(select count(*)::int from "stillroom_artist_collection_posts" as "member"
    where "member"."collection_id" = "stillroom_artist_collections"."id")`,
  coverId: sql<string | null>`(select "asset"."id" from "stillroom_artist_collection_posts" as "member"
    join "stillroom_posts" as "original" on "original"."id" = "member"."post_id"
    join "stillroom_media_assets" as "asset" on "asset"."id" = "original"."media_asset_id"
    where "member"."collection_id" = "stillroom_artist_collections"."id" and "asset"."status" = 'ready'
    order by "member"."added_at" desc, "member"."post_id" desc limit 1)`,
  coverType: sql<string | null>`(select "asset"."content_type" from "stillroom_artist_collection_posts" as "member"
    join "stillroom_posts" as "original" on "original"."id" = "member"."post_id"
    join "stillroom_media_assets" as "asset" on "asset"."id" = "original"."media_asset_id"
    where "member"."collection_id" = "stillroom_artist_collections"."id" and "asset"."status" = 'ready'
    order by "member"."added_at" desc, "member"."post_id" desc limit 1)`,
};
