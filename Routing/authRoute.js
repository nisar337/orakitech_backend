import { Router } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import Admin from "../models/admin.js";
import User from "../models/user.js";
import TemporaryUser from "../models/tempUser.js";
import Order from "../models/order.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { storage } from "../cloudConfig.js";
import { sendOtpEmail } from "../Helpers/mailer.js";

const router = Router();

const uploadAvatar = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
});

router.post("/register-request", async (req, res, next) => {
  try {
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

    const existing = await User.findOne({ email }).select("_id");
    if (existing) {
      return res.status(409).json({ message: "Email is already registered." });
    }

    const otpCode = generateOtpCode();
    const otpHash = await bcrypt.hash(otpCode, 10);
    const passwordHash = await bcrypt.hash(password, 10);

    const tempPayload = {
      name,
      email,
      phone,
      passwordHash,
      otpHash,
      otpExpiresAt: registerOtpExpiresAt(),
      attemptCount: 0,
    };

    await TemporaryUser.findOneAndUpdate(
      { email },
      { $set: tempPayload },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    await sendOtpEmail({
      to: email,
      otpCode,
      name,
      subject: "Verify your OrakiTech account",
    });

    res.json({ ok: true, message: "OTP sent to email.", email });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/me/password", requireAdmin, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!currentPassword) {
      return res.status(400).json({ message: "Current password is required." });
    }
    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "New password must be at least 8 characters." });
    }

    const admin = await Admin.findOne({
      username: req.admin.sub,
      active: true,
    }).select("+passwordHash");

    if (!admin || !admin.passwordHash) {
      return res.status(401).json({ message: "Admin no longer exists or is inactive." });
    }

    const match = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!match) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    await admin.save();

    res.json({ ok: true, message: "Password updated successfully." });
  } catch (err) {
    next(err);
  }
});

router.post("/verify-registration", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();

    if (!email || otp.length !== 6) {
      return res.status(400).json({ message: "Email and 6-digit OTP are required." });
    }

    const tempUser = await TemporaryUser.findOne({ email }).select(
      "+otpHash +passwordHash"
    );
    if (!tempUser) {
      return res.status(404).json({ message: "No pending registration found." });
    }

    if (tempUser.otpExpiresAt < new Date()) {
      await TemporaryUser.deleteOne({ _id: tempUser._id });
      return res.status(410).json({ message: "OTP expired. Please request a new code." });
    }

    const validOtp = await bcrypt.compare(otp, tempUser.otpHash);
    if (!validOtp) {
      tempUser.attemptCount += 1;
      await tempUser.save();
      return res.status(401).json({ message: "Invalid OTP code." });
    }

    const existing = await User.findOne({ email }).select("_id");
    if (existing) {
      await TemporaryUser.deleteOne({ _id: tempUser._id });
      return res.status(409).json({ message: "Email is already registered." });
    }

    const secret = userJwtSecret();
    if (!secret) {
      return res.status(500).json({
        message:
          "USER_JWT_SECRET must be set in the server environment (min 16 characters).",
      });
    }

    const user = await User.create({
      name: tempUser.name,
      email: tempUser.email,
      phone: tempUser.phone,
      passwordHash: tempUser.passwordHash,
      verified: true,
    });

    await TemporaryUser.deleteOne({ _id: tempUser._id });

    const token = jwt.sign({ id: String(user._id), role: "user" }, secret, {
      expiresIn: "7d",
    });
    res.cookie(USER_SESSION_COOKIE, token, userCookieOptions(req));
    res.status(201).json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/resend-register-otp", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const tempUser = await TemporaryUser.findOne({ email }).select(
      "+otpHash +passwordHash"
    );
    if (!tempUser) {
      return res.status(404).json({ message: "No pending registration found." });
    }

    if (tempUser.attemptCount >= REGISTER_OTP_MAX_SENDS) {
      return res.status(429).json({ message: "Too many OTP attempts. Try again later." });
    }

    const otpCode = generateOtpCode();
    tempUser.otpHash = await bcrypt.hash(otpCode, 10);
    tempUser.otpExpiresAt = registerOtpExpiresAt();
    tempUser.attemptCount += 1;
    await tempUser.save();

    await sendOtpEmail({
      to: email,
      otpCode,
      name: tempUser.name,
      subject: "Verify your OrakiTech account",
    });

    res.json({ ok: true, message: "OTP resent." });
  } catch (err) {
    next(err);
  }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const user = await User.findOne({ email }).select(
      "+resetOtpHash +resetOtpRequestedAt +resetOtpSendCount +resetOtpWindowStart"
    );
    if (!user) {
      return res.status(404).json({ message: "Email not found." });
    }

    const now = new Date();
    if (user.resetOtpRequestedAt && now - user.resetOtpRequestedAt < RESET_OTP_RESEND_COOLDOWN_MS) {
      return res.status(429).json({ message: "Please wait before requesting another OTP." });
    }

    if (!user.resetOtpWindowStart || now - user.resetOtpWindowStart > RESET_OTP_WINDOW_MS) {
      user.resetOtpWindowStart = now;
      user.resetOtpSendCount = 0;
    }

    if (user.resetOtpSendCount >= RESET_OTP_MAX_SENDS) {
      return res.status(429).json({ message: "Too many OTP requests. Try again later." });
    }

    const otpCode = generateOtpCode();
    user.resetOtpHash = await bcrypt.hash(otpCode, 10);
    user.resetOtpExpiresAt = resetOtpExpiresAt();
    user.resetOtpRequestedAt = now;
    user.resetOtpSendCount += 1;
    await user.save();

    await sendOtpEmail({
      to: email,
      otpCode,
      name: user.name,
      subject: "Reset your OrakiTech password",
    });

    res.json({ ok: true, message: "OTP sent to email." });
  } catch (err) {
    next(err);
  }
});

router.post("/verify-otp", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();

    if (!email || otp.length !== 6) {
      return res.status(400).json({ message: "Email and 6-digit OTP are required." });
    }

    const user = await User.findOne({ email }).select("+resetOtpHash");
    if (!user || !user.resetOtpHash) {
      return res.status(404).json({ message: "No reset request found." });
    }

    if (!user.resetOtpExpiresAt || user.resetOtpExpiresAt < new Date()) {
      user.resetOtpHash = undefined;
      user.resetOtpExpiresAt = null;
      await user.save();
      return res.status(410).json({ message: "OTP expired. Request a new one." });
    }

    const validOtp = await bcrypt.compare(otp, user.resetOtpHash);
    if (!validOtp) {
      return res.status(401).json({ message: "Invalid OTP code." });
    }

    const secret = userJwtSecret();
    if (!secret) {
      return res.status(500).json({ message: "USER_JWT_SECRET must be set." });
    }

    const token = jwt.sign({ id: String(user._id), email }, secret, {
      expiresIn: RESET_TOKEN_TTL,
    });

    res.json({ ok: true, token });
  } catch (err) {
    next(err);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) {
      return res.status(401).json({ message: "Authorization token required." });
    }

    const secret = userJwtSecret();
    if (!secret) {
      return res.status(500).json({ message: "USER_JWT_SECRET must be set." });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return res.status(401).json({ message: "Reset token expired or invalid." });
    }

    const newPassword = String(req.body?.password || "");
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    const user = await User.findById(payload?.id).select("+passwordHash +resetOtpHash");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetOtpHash = undefined;
    user.resetOtpExpiresAt = null;
    user.resetOtpRequestedAt = null;
    user.resetOtpSendCount = 0;
    user.resetOtpWindowStart = null;
    await user.save();

    const sessionToken = jwt.sign({ id: String(user._id), role: "user" }, secret, {
      expiresIn: "7d",
    });
    res.cookie(USER_SESSION_COOKIE, sessionToken, userCookieOptions(req));
    res.json({ ok: true, message: "Password updated successfully.", user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});
const USER_SESSION_COOKIE = "orakitech_session";
const USER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_OTP_TTL_MS = 5 * 60 * 1000;
const RESET_TOKEN_TTL = "10m";
const RESET_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const RESET_OTP_WINDOW_MS = 60 * 60 * 1000;
const RESET_OTP_MAX_SENDS = 5;
const REGISTER_OTP_TTL_MS = 5 * 60 * 1000;
const REGISTER_OTP_MAX_SENDS = 5;

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

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function resetOtpExpiresAt() {
  return new Date(Date.now() + RESET_OTP_TTL_MS);
}

function registerOtpExpiresAt() {
  return new Date(Date.now() + REGISTER_OTP_TTL_MS);
}

function sanitizeUser(doc) {
  return {
    id: String(doc._id),
    name: doc.name || "",
    email: doc.email || "",
    phone: doc.phone || "",
  };
}

function userCookieOptions(req) {
  // On Render and other platforms, NODE_ENV might not be set. Detect from X-Forwarded-Proto header.
  const isHttps = req?.headers?.["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  const isProd = isHttps || process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
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
    res.cookie(USER_SESSION_COOKIE, token, userCookieOptions(req));
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
    res.cookie(USER_SESSION_COOKIE, token, userCookieOptions(req));
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/user/logout", (_req, res) => {
  res.clearCookie(USER_SESSION_COOKIE, userCookieOptions(_req));
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
    res.cookie(USER_SESSION_COOKIE, token, userCookieOptions(req));
    res.json({ ok: true, user: sanitizeUser(user), message: "Profile updated successfully." });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Email is already in use." });
    }
    next(err);
  }
});

/** GET /api/auth/user/addresses — list saved addresses */
router.get("/user/addresses", async (req, res, next) => {
  try {
    const currentUser = await resolveSessionUser(req);
    if (!currentUser) return res.status(401).json({ message: "No active session." });
    const user = await User.findById(currentUser._id).select("addresses");
    if (!user) return res.status(404).json({ message: "User not found." });
    res.json({ addresses: user.addresses || [] });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/user/addresses — add a new address (max 10) */
router.post("/user/addresses", async (req, res, next) => {
  try {
    const currentUser = await resolveSessionUser(req);
    if (!currentUser) return res.status(401).json({ message: "No active session." });
    const user = await User.findById(currentUser._id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (user.addresses.length >= 10) {
      return res.status(400).json({ message: "Maximum of 10 addresses allowed." });
    }
    const { label, fullName, phone, address, city, country, isDefault } = req.body;
    if (!String(address || "").trim() || !String(city || "").trim() || !String(country || "").trim()) {
      return res.status(400).json({ message: "Address, city and country are required." });
    }
    if (isDefault) {
      user.addresses.forEach((a) => { a.isDefault = false; });
    }
    const newAddr = {
      label: String(label || "Home").trim().slice(0, 40),
      fullName: String(fullName || "").trim().slice(0, 120),
      phone: String(phone || "").trim().slice(0, 32),
      address: String(address || "").trim().slice(0, 300),
      city: String(city || "").trim().slice(0, 100),
      country: String(country || "").trim().slice(0, 100),
      isDefault: Boolean(isDefault) || user.addresses.length === 0,
    };
    user.addresses.push(newAddr);
    await user.save();
    res.status(201).json({ addresses: user.addresses });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/auth/user/addresses/:addrId — update an existing address */
router.put("/user/addresses/:addrId", async (req, res, next) => {
  try {
    const currentUser = await resolveSessionUser(req);
    if (!currentUser) return res.status(401).json({ message: "No active session." });
    const user = await User.findById(currentUser._id);
    if (!user) return res.status(404).json({ message: "User not found." });
    const addr = user.addresses.id(req.params.addrId);
    if (!addr) return res.status(404).json({ message: "Address not found." });
    const { label, fullName, phone, address, city, country, isDefault } = req.body;
    if (!String(address || "").trim() || !String(city || "").trim() || !String(country || "").trim()) {
      return res.status(400).json({ message: "Address, city and country are required." });
    }
    if (isDefault) {
      user.addresses.forEach((a) => { a.isDefault = false; });
    }
    addr.label = String(label || addr.label).trim().slice(0, 40);
    addr.fullName = String(fullName ?? addr.fullName).trim().slice(0, 120);
    addr.phone = String(phone ?? addr.phone).trim().slice(0, 32);
    addr.address = String(address || "").trim().slice(0, 300);
    addr.city = String(city || "").trim().slice(0, 100);
    addr.country = String(country || "").trim().slice(0, 100);
    addr.isDefault = Boolean(isDefault);
    await user.save();
    res.json({ addresses: user.addresses });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/auth/user/addresses/:addrId — remove an address */
router.delete("/user/addresses/:addrId", async (req, res, next) => {
  try {
    const currentUser = await resolveSessionUser(req);
    if (!currentUser) return res.status(401).json({ message: "No active session." });
    const user = await User.findById(currentUser._id);
    if (!user) return res.status(404).json({ message: "User not found." });
    const addr = user.addresses.id(req.params.addrId);
    if (!addr) return res.status(404).json({ message: "Address not found." });
    const wasDefault = addr.isDefault;
    addr.deleteOne();
    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }
    await user.save();
    res.json({ addresses: user.addresses });
  } catch (err) {
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
        { returnDocument: "after" }
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

/** Delete a customer account (admin only). */
router.delete("/admin/customers/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid id." });
    }
    const user = await User.findById(id).select("_id email");
    if (!user) {
      return res.status(404).json({ message: "Customer not found." });
    }
    await User.findByIdAndDelete(id);
    res.json({ ok: true, id: String(user._id) });
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
