import { z } from "zod";

// Use the same normalization for onboarding and subsequent username changes.
export const usernameSchema = z.string()
  .transform((value) => value.trim().replace(/^@/, "").trim())
  .pipe(z.string().min(1, "Choose a username.").max(32, "Usernames must be 32 characters or fewer."));

export const createProfileSchema = z.object({
  role: z.enum(["Fan", "Artist"]),
  name: z.string().trim().min(1).max(100),
  username: usernameSchema,
}).strict();

export const changeUsernameSchema = z.object({
  username: usernameSchema,
}).strict();
