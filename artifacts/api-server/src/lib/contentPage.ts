import { z } from "zod";

export const PAGE_SIZE = 20;
export const contentPageSchema = z.object({
  view: z.enum(["feed", "explore"]).optional(),
  cursor: z.string().min(1).max(8192).regex(/^[A-Za-z0-9_-]+$/).optional(),
  page: z.coerce.number().int().min(0).max(50000).default(0),
  shelfPage: z.coerce.number().int().min(0).max(50000).default(0),
  shelfList: z.enum(["true"]).optional(),
  artistList: z.enum(["true"]).optional(),
  boardId: z.string().uuid().optional(),
  authorId: z.string().min(1).max(200).optional(),
  profileId: z.string().min(1).max(200).optional(),
  mine: z.enum(["true"]).optional(),
  repostsBy: z.string().min(1).max(200).optional(),
  shelfId: z.string().uuid().optional(),
  postId: z.string().uuid().optional(),
  followed: z.enum(["true"]).optional(),
  q: z.string().trim().max(200).optional(),
  category: z.enum(["Music", "Film", "Photography", "Painting", "Fashion", "Other"]).optional(),
}).refine((selection) => !selection.cursor || Boolean(selection.view), "A cursor requires a public view.")
  .refine((selection) => !selection.view || (selection.page === 0
    && ![selection.boardId, selection.authorId, selection.profileId, selection.mine,
      selection.repostsBy, selection.shelfId, selection.postId].some(Boolean)),
  "Public views use cursors, not legacy page or ownership filters.");

export type ContentPage = z.infer<typeof contentPageSchema>;

export function pageWindow<T>(rows: T[], page: number) {
  return {
    rows: rows.slice(0, PAGE_SIZE),
    pagination: { page, pageSize: PAGE_SIZE, hasMore: rows.length > PAGE_SIZE },
  };
}
