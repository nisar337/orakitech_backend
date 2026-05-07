import { Router } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Order from "../models/order.js";
import Listing from "../models/listing.js";
import User from "../models/user.js";

const router = Router();
const USER_SESSION_COOKIE = "orakitech_session";

function userJwtSecret() {
  const secret =
    process.env.USER_JWT_SECRET || process.env.ADMIN_JWT_SECRET || "";
  return secret.length >= 16 ? secret : null;
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

/** Mounted at app.use("/api/orders", router) — paths are relative to /api/orders */
router.post("/", async (req, res, next) => {
  try {
    const sessionUser = await resolveSessionUser(req);
    const { items, source, paymentMethod, customer } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Order must include items." });
    }
    if (!["buy_now", "cart_checkout"].includes(source)) {
      return res.status(400).json({ message: "Invalid order source." });
    }
    if (paymentMethod !== "cod") {
      return res.status(400).json({ message: "Invalid payment method." });
    }
    const safeCustomer = {
      fullName: String(customer?.fullName || "").trim(),
      email: String(customer?.email || "").trim(),
      phone: String(customer?.phone || "").trim(),
      address: String(customer?.address || "").trim(),
      city: String(customer?.city || "").trim(),
      country: String(customer?.country || "").trim(),
      notes: String(customer?.notes || "").trim(),
    };
    if (
      !safeCustomer.fullName ||
      !safeCustomer.email ||
      !safeCustomer.phone ||
      !safeCustomer.address ||
      !safeCustomer.city ||
      !safeCustomer.country
    ) {
      return res.status(400).json({ message: "Missing customer details." });
    }

    const lineItems = [];
    let totalUSD = 0;

    for (const row of items) {
      const { listingId, quantity } = row;
      if (!mongoose.Types.ObjectId.isValid(listingId)) {
        return res.status(400).json({ message: "Invalid product id." });
      }
      const q = Math.max(1, Math.min(99, Number(quantity) || 1));
      const list = await Listing.findById(listingId);
      if (!list) {
        return res
          .status(400)
          .json({ message: `Product not found: ${listingId}` });
      }
      const unit = Number(list.price);
      if (!Number.isFinite(unit) || unit < 0) {
        return res.status(400).json({ message: "Invalid product price." });
      }
      const lineTotal = unit * q;
      totalUSD += lineTotal;
      lineItems.push({
        listingId: list._id,
        title: list.title,
        slug: list.slug,
        unitPrice: unit,
        quantity: q,
        lineTotal,
      });
    }

    const order = new Order({
      userId: sessionUser?._id || null,
      items: lineItems,
      source,
      totalUSD,
      paymentMethod,
      customer: safeCustomer,
    });
    await order.save();
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(200);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

router.get("/my", async (req, res, next) => {
  try {
    const user = await resolveSessionUser(req);
    if (!user) {
      return res.status(401).json({ message: "No active user session." });
    }
    const email = String(user.email || "").trim().toLowerCase();
    const orders = await Order.find({
      $or: [
        { userId: user._id },
        { "customer.email": { $regex: `^${email}$`, $options: "i" } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({
      user: {
        id: String(user._id),
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
      },
      orders,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }
    const doc = await Order.findById(id);
    if (!doc) return res.status(404).json({ message: "Order not found." });

    const customer = req.body?.customer || {};
    doc.customer.fullName = String(
      customer.fullName ?? doc.customer.fullName
    ).trim();
    doc.customer.email = String(customer.email ?? doc.customer.email).trim();
    doc.customer.phone = String(customer.phone ?? doc.customer.phone).trim();
    doc.customer.address = String(customer.address ?? doc.customer.address).trim();
    doc.customer.city = String(customer.city ?? doc.customer.city).trim();
    doc.customer.country = String(customer.country ?? doc.customer.country).trim();
    doc.customer.notes = String(customer.notes ?? doc.customer.notes ?? "").trim();

    if (
      !doc.customer.fullName ||
      !doc.customer.email ||
      !doc.customer.phone ||
      !doc.customer.address ||
      !doc.customer.city ||
      !doc.customer.country
    ) {
      return res
        .status(400)
        .json({ message: "Customer details cannot be empty." });
    }

    doc.paymentMethod = "cod";
    doc.status = String(req.body?.status ?? doc.status).trim() || "new";

    await doc.save();
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }
    const doc = await Order.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ message: "Order not found." });
    res.json({ ok: true, id: doc._id });
  } catch (err) {
    next(err);
  }
});

export default router;
