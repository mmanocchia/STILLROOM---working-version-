import { getAuth } from "@clerk/express";
import { db, profiles } from "@workspace/db";
import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const createProfileSchema = z.object({
  role: z.enum(["Fan", "Artist"]),
  name: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(32),
});

function currentUserId(req: Request): string | null {
  return getAuth(req).userId ?? null;
}

function presentProfile(profile: typeof profiles.$inferSelect | undefined) {
  if (!profile) return null;
  return {
    id: profile.id,
    role: profile.role,
    name: profile.displayName,
    username: profile.username,
    biography: profile.biography,
    interests: profile.interests,
    profileImageAssetId: profile.profileImageAssetId,
    profileImage: profile.profileImageAssetId
      ? `/api/media/${profile.profileImageAssetId}`
      : "",
    createdAt: profile.createdAt.getTime(),
  };
}

router.get("/auth/user", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.json({ userId: null, profile: null });
    return;
  }

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  res.json({ userId, profile: presentProfile(profile) });
});

router.post("/auth/profile", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in before creating your profile." });
    return;
  }

  const parsed = createProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a name, username, and account type." });
    return;
  }

  const name = parsed.data.name;
  const username = parsed.data.username.replace(/^@/, "");
  const usernameKey = username.toLocaleLowerCase();
  if (!username || username.length > 32) {
    res.status(400).json({ error: "Choose a valid username." });
    return;
  }

  const [existingProfile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (existingProfile) {
    res.status(409).json({ error: "This account already has a Stillroom profile." });
    return;
  }

  try {
    const [profile] = await db
      .insert(profiles)
      .values({
        id: userId,
        role: parsed.data.role,
        displayName: name,
        username,
        usernameKey,
      })
      .returning();
    res.status(201).json({ profile: presentProfile(profile) });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "23505") {
      res.status(409).json({ error: "That username is already in use." });
      return;
    }
    req.log.error({ err: error }, "Failed to create Stillroom profile");
    res.status(500).json({ error: "Your profile could not be created." });
  }
});

export default router;
