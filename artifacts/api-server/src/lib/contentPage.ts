import { z } from "zod";

export const PAGE_SIZE = 20;
export const contentPageSchema = z.object({
  page: z.coerce.number().int().min(0).max(50000).default(0),
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
});

export type ContentPage = z.infer<typeof contentPageSchema>;

export function pageWindow<T>(rows: T[], page: number) {
  return {
    rows: rows.slice(0, PAGE_SIZE),
    pagination: { page, pageSize: PAGE_SIZE, hasMore: rows.length > PAGE_SIZE },
  };
}
