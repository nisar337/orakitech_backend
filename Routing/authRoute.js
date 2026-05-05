import { Router } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import Admin from "../models/admin.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { storage } from "../cloudConfig.js";

const router = Router();

const uploadAvatar = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
});

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
