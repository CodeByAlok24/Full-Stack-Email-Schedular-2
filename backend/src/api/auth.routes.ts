import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy, type Profile as GoogleProfile } from "passport-google-oauth20";
import bcrypt from "bcryptjs";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "../db/client";
import { env, googleConfigured } from "../config/env";

export const authRouter = Router();

interface DbUser {
  id: string;
  google_id: string | null;
  email: string;
  name: string;
  avatar_url: string | null;
  password_hash?: string | null;
}

interface PublicUser {
  name: string;
  email: string;
  avatarUrl: string;
}

interface GoogleIdentity {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublicUser(user: DbUser): PublicUser {
  return {
    name: user.name,
    email: user.email,
    avatarUrl: user.avatar_url ?? "",
  };
}

function oauthFailureUrl(): string {
  return `${env.frontendUrl.replace(/\/$/, "")}/login?error=oauth`;
}

async function findUserByGoogleId(connection: PoolConnection, googleId: string): Promise<DbUser | undefined> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT * FROM users WHERE google_id = ? LIMIT 1 FOR UPDATE",
    [googleId],
  );
  return (rows as DbUser[])[0];
}

async function findUserByEmail(connection: PoolConnection, email: string): Promise<DbUser | undefined> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT * FROM users WHERE email = ? LIMIT 1 FOR UPDATE",
    [email],
  );
  return (rows as DbUser[])[0];
}

async function upsertGoogleUser(identity: GoogleIdentity): Promise<DbUser | null> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let user = await findUserByGoogleId(connection, identity.googleId);
    if (!user) user = await findUserByEmail(connection, identity.email);

    if (user?.google_id && user.google_id !== identity.googleId) {
      await connection.rollback();
      return null;
    }

    if (user) {
      if (user.email !== identity.email) {
        const emailOwner = await findUserByEmail(connection, identity.email);
        if (emailOwner && emailOwner.id !== user.id) {
          await connection.rollback();
          return null;
        }
      }
      await connection.query(
        "UPDATE users SET google_id = ?, email = ?, name = ?, avatar_url = ? WHERE id = ?",
        [identity.googleId, identity.email, identity.name, identity.avatarUrl, user.id],
      );
    } else {
      const id = randomUUID();
      await connection.query(
        "INSERT INTO users (id, google_id, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)",
        [id, identity.googleId, identity.email, identity.name, identity.avatarUrl],
      );
      user = { id, google_id: identity.googleId, email: identity.email, name: identity.name, avatar_url: identity.avatarUrl };
    }

    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [user.id]);
    const saved = (rows as DbUser[])[0];
    if (!saved) throw new Error("Google user could not be loaded after account provisioning");
    await connection.commit();
    return saved;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      console.error("[auth] rollback failed", error);
    }
    throw error;
  } finally {
    connection.release();
  }
}

if (googleConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.google.clientId,
        clientSecret: env.google.clientSecret,
        callbackURL: env.google.callbackUrl,
        state: true,
        scope: ["profile", "email"],
      },
      async (_accessToken, _refreshToken, profile: GoogleProfile, done) => {
        try {
          const googleId = profile.id?.trim() ?? "";
          const verifiedEmail = profile.emails?.find((entry) => entry.verified && entry.value.trim());
          const email = verifiedEmail?.value.trim().toLowerCase() ?? "";
          if (!googleId || !email || !EMAIL_RE.test(email)) {
            done(null, false);
            return;
          }
          const name = profile.displayName?.trim() || email.split("@")[0] || "User";
          const avatar = profile.photos?.[0]?.value?.trim() ?? "";
          const user = await upsertGoogleUser({
            googleId,
            email,
            name,
            avatarUrl: avatar && /^https?:\/\//i.test(avatar) ? avatar : null,
          });
          if (!user) {
            done(null, false);
            return;
          }
          done(null, user as Express.User);
        } catch (error) {
          done(error as Error);
        }
      },
    ),
  );
}

passport.serializeUser((user: Express.User, done) => {
  done(null, (user as DbUser).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
    done(null, (rows as DbUser[])[0] ?? null);
  } catch (error) {
    done(error as Error);
  }
});

function requireGoogleConfiguration(res: Response): boolean {
  if (googleConfigured) return true;
  res.status(503).json({
    message: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL.",
  });
  return false;
}

authRouter.get("/google", (req: Request, res: Response, next: NextFunction) => {
  if (!requireGoogleConfiguration(res)) return;
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

authRouter.get(
  "/callback",
  (req: Request, res: Response, next: NextFunction) => {
    if (!requireGoogleConfiguration(res)) return;
    passport.authenticate("google", {
      failureRedirect: oauthFailureUrl(),
      failureMessage: false,
    })(req, res, (error?: unknown) => {
      if (error) {
        console.error("[auth] Google OAuth callback failed", error);
        if (!res.headersSent) res.redirect(oauthFailureUrl());
        return;
      }
      next();
    });
  },
  (_req: Request, res: Response) => {
    res.redirect(env.frontendUrl);
  },
);

authRouter.get("/me", (req: Request, res: Response) => {
  const user = (req as Request & { user?: DbUser }).user;
  res.json({ user: user ? toPublicUser(user) : null });
});

authRouter.post("/signup", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = (req.body ?? {}) as { email?: unknown; password?: unknown; name?: unknown };
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const cleanPass = typeof password === "string" ? password : "";
    const cleanName = typeof name === "string" && name.trim() ? name.trim() : cleanEmail.split("@")[0] ?? "User";
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
      res.status(400).json({ message: "Valid email is required" });
      return;
    }
    if (!cleanPass || cleanPass.length < 6) {
      res.status(400).json({ message: "Password must be at least 6 characters" });
      return;
    }
    const [existing] = await pool.query<RowDataPacket[]>("SELECT id FROM users WHERE email = ? LIMIT 1", [cleanEmail]);
    if ((existing as DbUser[]).length > 0) {
      res.status(409).json({ message: "Email already registered — please login" });
      return;
    }
    const id = randomUUID();
    const hash = await bcrypt.hash(cleanPass, 10);
    await pool.query("INSERT INTO users (id, email, name, password_hash) VALUES (?,?,?,?)", [id, cleanEmail, cleanName, hash]);
    const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
    const user = (rows as DbUser[])[0];
    req.login(user as Express.User, (error) => {
      if (error) {
        next(error);
        return;
      }
      res.json({ user: toPublicUser(user) });
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const cleanPass = typeof password === "string" ? password : "";
    if (!cleanEmail || !cleanPass) {
      res.status(400).json({ message: "Email and password are required" });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM users WHERE email = ? LIMIT 1", [cleanEmail]);
    const user = (rows as DbUser[])[0];
    if (!user || !user.password_hash) {
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }
    const valid = await bcrypt.compare(cleanPass, user.password_hash);
    if (!valid) {
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }
    req.login(user as Express.User, (error) => {
      if (error) {
        next(error);
        return;
      }
      res.json({ user: toPublicUser(user) });
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (req: Request, res: Response, next: NextFunction) => {
  req.logout((logoutError) => {
    if (logoutError) {
      next(logoutError);
      return;
    }
    const clearCookie = () => {
      res.clearCookie(env.sessionCookieName, {
        httpOnly: true,
        sameSite: "lax",
        secure: env.isProduction,
        path: "/",
      });
      res.json({ message: "Logged out" });
    };
    if (!req.session) {
      clearCookie();
      return;
    }
    req.session.destroy((sessionError) => {
      if (sessionError) {
        next(sessionError);
        return;
      }
      clearCookie();
    });
  });
});
