import { sql } from "drizzle-orm";

// Keep explicit qualifiers inside these correlated subqueries. Drizzle's
// single-table SELECT mapping removes qualifiers from interpolated Column
// objects, even when those objects occur in an inner SELECT.
export const shelfSummaryFields = {
  savedCount: sql<number>`(select count(*)::int from "stillroom_shelf_posts" as "saved"
    where "saved"."shelf_id" = "stillroom_shelves"."id")`,
  coverAssetId: sql<string | null>`(select "cover_post"."media_asset_id"
    from "stillroom_shelf_posts" as "cover_saved"
    inner join "stillroom_posts" as "cover_post" on "cover_post"."id" = "cover_saved"."post_id"
    inner join "stillroom_media_assets" as "cover_asset" on "cover_asset"."id" = "cover_post"."media_asset_id"
    where "cover_saved"."shelf_id" = "stillroom_shelves"."id" and "cover_asset"."status" = 'ready'
    order by "cover_saved"."created_at" desc, "cover_saved"."post_id" desc limit 1)`,
};
