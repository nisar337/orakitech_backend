import { Router } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import Admin from "../models/admin.js";
import User from "../models/user.js";
import Order from "../models/order.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { storage } from "../cloudConfig.js";

const router = Router();

const uploadAvatar = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
});
const USER_SESSION_COOKIE = "orakitech_session";
const USER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function jwtSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

function normalizeUsername(u) {
  return String(u || "")
    .trim()
    .toLowerCase()
    .slice(0, 64);
}

function userJwtSecret() {
  const secret =
    process.env.USER_JWT_SECRET || process.env.ADMIN_JWT_SECRET || "";
  return secret.length >= 16 ? secret : null;
}

function normalizeName(v) {
  return String(v || "")
    .trim()
    .slice(0, 120);
}

function normalizeEmail(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

function normalizePhone(v) {
  const digits = String(v || "").replace(/\D/g, "").slice(0, 10);
  return digits ? `+92${digits}` : "";
}

function sanitizeUser(doc) {
  return {
    id: String(doc._id),
    name: doc.name || "",
    email: doc.email || "",
    phone: doc.phone || "",
  };
}

function userCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: USER_SESSION_TTL_MS,
  };
}

function readSessionToken(req) {
  const rawCookieHeader = String(req.headers.cookie || "");
  if (!rawCookieHeader) return "";
  const parts = rawCookieHeader.split(";").map((item) => item.trim());
  const cookieName = `${USER_SESSION_COOKIE}=`;
  const hit = parts.find((entry) => entry.startsWith(cookieName));
  if (!hit) return "";
  return decodeURIComponent(hit.slice(cookieName.length));
}

async function resolveSessionUser(req) {
  const secret = userJwtSecret();
  if (!secret) return null;
  const token = readSessionToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret);
    const user = await User.findById(payload?.id).select("name email phone");
    return user || null;
  } catch {
    return null;
  }
}

/** Ensures one primary admin (oldest account) when field was missing on legacy data. */
async function ensurePrimaryAdmin() {
  const n = await Admin.countDocuments({ isPrimary: true });
  if (n > 0) return;
  const oldest = await Admin.findOne().sort({ createdAt: 1 });
  if (!oldest) return;
  await Admin.updateMany({ _id: { $ne: oldest._id } }, { $set: { isPrimary: false } });
  oldest.isPrimary = true;
  await oldest.save();
}

/** Public: whether the first admin must be created via POST /admin/setup */
router.post("/user/register", async (req, res, next) => {
  try {
    const secret = userJwtSecret();
    if (!secret) {
      return res.status(500).json({
        message:
          "USER_JWT_SECRET must be set in the server environment (min 16 characters).",
      });
    }

    const name = normalizeName(req.body?.name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const password = String(req.body?.password || "");

    if (name.length < 2) {
      return res.status(400).json({ message: "Name must be at least 2 characters." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Provide a valid email address." });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, phone, passwordHash });

    const token = jwt.sign({ id: String(user._id), role: "user" }, secret, {
      expiresIn: "7d",
    });
    res.cookie(USER_SESSION_COOKIE, token, userCookieOptions());
    res.status(201).json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Email is already registered." });
    }
    next(err);
  }
});

router.post("/user/login", async (req, res, next) => {
  try {
    const secret = userJwtSecret();
    if (!secret) {
      return res.status(500).json({
        message:
          "USER_JWT_SECRET must be set in the server environment (min 16 characters).",
      });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = jwt.sign({ id: String(user._id), role: "user" }, secret, {
      expiresIn: "7d",
    });
    res.cookie(USER_SESSION_COOKIE, token, userCookieOptions());
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/user/logout", (_req, res) => {
  res.clearCookie(USER_SESSION_COOKIE, userCookieOptions());
  res.json({ ok: true });
});

router.get("/user/session", async (req, res, next) => {
  try {
    const user = await resolveSessionUser(req);
    if (!user) return res.status(401).json({ message: "No active session." });
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.put("/user/update-profile", async (req, res, next) => {
  try {
    const secret = userJwtSecret();
    if (!secret) {
      return res.status(500).json({
        message: "USER_JWT_SECRET must be set in the server environment.",
      });
    }

    const currentUser = await resolveSessionUser(req);
    if (!currentUser) {
      return res.status(401).json({ message: "No active session." });
    }

    const name = normalizeName(req.body?.name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (name.length < 2) {
      return res.status(400).json({ message: "Name must be at least 2 characters." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Provide a valid email address." });
    }

    const user = await User.findById(currentUser._id).select("+passwordHash");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (email !== currentUser.email) {
      const emailExists = await User.findOne({ email, _id: { $ne: user._id } });
      if (emailExists) {
        return res.status(400).json({ message: "Email is already in use by another account." });
      }
    }

    if (currentPassword && newPassword) {
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "New password must be at least 8 characters." });
      }
      const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ message: "Current password is incorrect." });
      }
      user.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    user.name = name;
    user.email = email;
    user.phone = phone;
    user.lastLoginAt = new Date();
    await user.save();

    const token = jwt.sign({ id: String(user._id), role: "user" }, secret, {
      expiresIn: "7d",
    });
    res.cookie(USER_SESSION_COOKIE, token, userCookieOptions());
    res.json({ ok: true, user: sanitizeUser(user), message: "Profile updated successfully." });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Email is already in use." });
    }
    next(err);
  }
});

/** Public: whether the first admin must be created via POST /admin/setup */
router.get("/admin/status", async (_req, res, next) => {
  try {
    const count = await Admin.countDocuments();
    res.json({ needsSetup: count === 0, hasAdmins: count > 0 });
  } catch (err) {
    next(err);
  }
});

/** One-time: create the first admin when the collection is empty */
router.post("/admin/setup", async (req, res, next) => {
  try {
    const secret = jwtSecret();
    if (!secret) {
      return res.status(500).json({
        message:
          "ADMIN_JWT_SECRET must be set (min 16 characters) before creating an admin.",
      });
    }

    const existing = await Admin.countDocuments();
    if (existing > 0) {
      return res.status(403).json({
        message:
          "An admin account already exists. Sign in, then use Admin → Users to add more admins.",
      });
    }

    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const fullName = String(req.body?.fullName || "").trim().slice(0, 120);
    const email = String(req.body?.email || "").trim().slice(0, 120);

    if (username.length < 2) {
      return res.status(400).json({ message: "Username must be at least 2 characters." });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await Admin.create({
      username,
      passwordHash,
      fullName,
      email,
      active: true,
      isPrimary: true,
    });

    res.status(201).json({ ok: true, message: "Admin created. You can sign in now." });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "That username is already taken." });
    }
    next(err);
  }
});

router.post("/admin/login", async (req, res, next) => {
  try {
    const secret = jwtSecret();
    if (!secret) {
      return res.status(500).json({
        message:
          "ADMIN_JWT_SECRET must be set in the server environment (min 16 characters).",
      });
    }

    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    const admin = await Admin.findOne({
      username,
      active: true,
    }).select("+passwordHash");

    if (!admin || !admin.passwordHash) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const match = await bcrypt.compare(password, admin.passwordHash);
    if (!match) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const token = jwt.sign(
      { sub: admin.username, role: "admin", id: String(admin._id) },
      secret,
      { expiresIn: "8h" }
    );

    res.json({
      token,
      user: {
        username: admin.username,
        fullName: admin.fullName || "",
        email: admin.email || "",
        avatarUrl: admin.avatarUrl || "",
        isPrimary: Boolean(admin.isPrimary),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/me", requireAdmin, async (req, res, next) => {
  try {
    const admin = await Admin.findOne({
      username: req.admin.sub,
      active: true,
    }).select("username fullName email avatarUrl isPrimary");
    if (!admin) {
      return res.status(401).json({ message: "Admin no longer exists or is inactive." });
    }
    res.json({
      user: {
        username: admin.username,
        fullName: admin.fullName || "",
        email: admin.email || "",
        avatarUrl: admin.avatarUrl || "",
        role: admin.isPrimary ? "Primary Admin" : "Admin",
        isPrimary: Boolean(admin.isPrimary),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/admin/me/avatar",
  requireAdmin,
  (req, res, next) => {
    uploadAvatar.single("avatar")(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          message: err?.message || "Could not upload avatar.",
        });
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const fileUrl = req.file?.path || "";
      if (!fileUrl) {
        return res.status(400).json({ message: "No file uploaded." });
      }
      const admin = await Admin.findOneAndUpdate(
        { username: req.admin.sub, active: true },
        { $set: { avatarUrl: fileUrl } },
        { new: true }
      ).select("username fullName email avatarUrl isPrimary");
      if (!admin) {
        return res.status(401).json({ message: "Admin no longer exists or is inactive." });
      }
      res.json({
        ok: true,
        user: {
          username: admin.username,
          fullName: admin.fullName || "",
          email: admin.email || "",
          avatarUrl: admin.avatarUrl || "",
          role: admin.isPrimary ? "Primary Admin" : "Admin",
          isPrimary: Boolean(admin.isPrimary),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

  /** List admins (no passwords) — requires signed-in admin */
router.get("/admin/users", requireAdmin, async (_req, res, next) => {
  try {
    await ensurePrimaryAdmin();
    const admins = await Admin.find({})
      .select("username fullName email active createdAt isPrimary avatarUrl")
      .sort({ createdAt: 1 })
      .lean();
    res.json({ admins });
  } catch (err) {
    next(err);
  }
});

/** List all customer accounts with basic order stats (admin only). */
router.get("/admin/customers", requireAdmin, async (_req, res, next) => {
  try {
    const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
    const now = Date.now();
    const users = await User.find({})
      .select("name email phone createdAt lastLoginAt")
      .sort({ createdAt: -1 })
      .lean();

    const customers = await Promise.all(
      users.map(async (u) => {
        const email = String(u.email || "").trim();
        const orders = await Order.find({
          "customer.email": { $regex: `^${email}$`, $options: "i" },
        })
          .select("totalUSD status createdAt")
          .lean();
        const totalOrders = orders.length;
        const totalSpentUsd = orders.reduce(
          (sum, o) => sum + (Number(o.totalUSD) || 0),
          0
        );
        const latestOrder = orders.sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        )[0];
        const lastActiveAt = u.lastLoginAt || u.createdAt || null;
        const isActiveNow =
          Boolean(lastActiveAt) &&
          now - new Date(lastActiveAt).getTime() <= ACTIVE_WINDOW_MS;
        return {
          id: String(u._id),
          name: u.name || "",
          email: u.email || "",
          phone: u.phone || "",
          createdAt: u.createdAt || null,
          lastLoginAt: u.lastLoginAt || null,
          lastActiveAt,
          isActiveNow,
          totalOrders,
          totalSpentUsd,
          latestOrderStatus: latestOrder?.status || "",
        };
      })
    );

    res.json({ customers, serverTime: new Date(now).toISOString() });
  } catch (err) {
    next(err);
  }
});

/** Create another admin — stored in MongoDB with bcrypt hash */
router.post("/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const fullName = String(req.body?.fullName || "").trim().slice(0, 120);
    const email = String(req.body?.email || "").trim().slice(0, 120);

    if (username.length < 2) {
      return res.status(400).json({ message: "Username must be at least 2 characters." });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = await Admin.create({
      username,
      passwordHash,
      fullName,
      email,
      active: true,
      isPrimary: false,
    });

    res.status(201).json({
      ok: true,
      admin: {
        _id: doc._id,
        username: doc.username,
        fullName: doc.fullName || "",
        email: doc.email || "",
        isPrimary: false,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "That username is already taken." });
    }
    next(err);
  }
});

/** Delete a non-primary admin */
router.delete("/admin/users/:id", requireAdmin, async (req, res, next) => {
  try {
    await ensurePrimaryAdmin();
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid id." });
    }
    const doc = await Admin.findById(id);
    if (!doc) {
      return res.status(404).json({ message: "Admin not found." });
    }
    if (doc.isPrimary) {
      return res.status(403).json({
        message: "The primary admin account cannot be deleted.",
      });
    }
    await Admin.findByIdAndDelete(id);
    res.json({ ok: true, id: doc._id });
  } catch (err) {
    next(err);
  }
});

export default router;
