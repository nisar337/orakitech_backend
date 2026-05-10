import { Router } from "express";
import mongoose from "mongoose";
import { generateSlug } from "../Helpers/slug-generators.js";
import Listing from "../models/listing.js";
import multer from "multer";
import { storage } from "../cloudConfig.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = Router();

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
});

const DEFAULT_IMAGE =
  "https://images.pexels.com/photos/18105/pexels-photo.jpg";
const VALID_CATEGORIES = ["New Laptop", "Used Laptop", "Accessories", "External Hardrive"];
const VALID_STOCK_STATUSES = ["In stock", "Out of stock"];

function listingImageUrls(files) {
  const out = [];
  if (Array.isArray(files) && files.length) {
    files.forEach(({ filename, path: url }) => {
      out.push({
        filename: filename || "upload",
        url: url || "",
      });
    });
  }
  return out;
}

function parseSpecs(raw) {
  if (raw == null || raw === "") return [];
  let arr;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  } else {
    return [];
  }
  return arr
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      label: String(x.label ?? "")
        .trim()
        .slice(0, 120),
      value: String(x.value ?? "")
        .trim()
        .slice(0, 500),
    }))
    .filter((x) => x.label && x.value)
    .slice(0, 48);
}

async function uniqueSlugFromTitle(title) {
  let base = generateSlug(title);
  let slug = base;
  let n = 0;
  while (await Listing.exists({ slug })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid id." });
    }
    const doc = await Listing.findById(id);
    if (!doc) {
      return res.status(404).json({ message: "Listing not found." });
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  requireAdmin,
  (req, res, next) => {
    upload.array("images", 12)(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message });
      next();
    });
  },
  async (req, res, next) => {
    try {
      const {
        title,
        brand,
        ram,
        disk,
        storage,
        description,
        price,
        quantity,
        category,
        subCategory,
        type,
        stockStatus,
        specs: specsRaw,
      } = req.body;

      const specs = parseSpecs(specsRaw);

      const images = listingImageUrls(req.files);
      if (!images.length) {
        images.push({ filename: "default", url: DEFAULT_IMAGE });
      }
      if (!title || !brand || !description) {
        return res.status(400).json({ message: "Missing required fields." });
      }
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ message: "Invalid category." });
      }
      if (stockStatus && !VALID_STOCK_STATUSES.includes(stockStatus)) {
        return res.status(400).json({ message: "Invalid stock status." });
      }

      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return res.status(400).json({ message: "Invalid price." });
      }

      const qty =
        quantity === "" || quantity === undefined ? 1 : Number(quantity);
      const safeQty =
        Number.isFinite(qty) && qty >= 1 ? Math.min(12, Math.floor(qty)) : 1;

      const slug = await uniqueSlugFromTitle(title);

      const listing = new Listing({
        title: String(title).trim(),
        slug,
        brand: String(brand).trim(),
        ram: String(ram || "").trim(),
        disk: String(disk || "").trim(),
        storage: String(storage || "").trim(),
        description: String(description).trim(),
        price: priceNum,
        quantity: safeQty,
        category: String(category).trim(),
        subCategory: String(subCategory || "").trim(),
        type: String(type || "").trim(),
        stockStatus: stockStatus ? String(stockStatus).trim() : "In stock",
        images,
        specs,
      });
      await listing.save();
      res.status(201).json(listing);
    } catch (err) {
      console.log(err);
      if (err.name === "ValidationError") {
        return res.status(400).json({ message: err.message });
      }
      next(err);
    }
  }
);

router.put(
  "/:id",
  requireAdmin,
  (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid id." });
    }
    upload.array("images", 12)(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message });
      next();
    });
  },
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const doc = await Listing.findById(id);
      if (!doc) {
        return res.status(404).json({ message: "Listing not found." });
      }

      const {
        title,
        brand,
        ram,
        disk,
        storage,
        description,
        price,
        quantity,
        category,
        subCategory,
        type,
        stockStatus,
        existingImages,
        specs: specsRaw,
      } = req.body;
      if (category && !VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ message: "Invalid category." });
      }
      if (stockStatus && !VALID_STOCK_STATUSES.includes(stockStatus)) {
        return res.status(400).json({ message: "Invalid stock status." });
      }

      let images = listingImageUrls(req.files);
      if (!images.length) {
        try {
          const parsed = existingImages ? JSON.parse(existingImages) : null;
          if (Array.isArray(parsed) && parsed.length) {
            images = parsed;
          } else if (Array.isArray(doc.images) && doc.images.length) {
            images = [...doc.images];
          } else {
            images = [{ filename: "default", url: DEFAULT_IMAGE }];
          }
        } catch {
          images =
            Array.isArray(doc.images) && doc.images.length
              ? [...doc.images]
              : [{ filename: "default", url: DEFAULT_IMAGE }];
        }
      }

      const priceNum = Number(price);
      const qty =
        quantity === "" || quantity === undefined ? 1 : Number(quantity);
      const safeQty =
        Number.isFinite(qty) && qty >= 1 ? Math.min(12, Math.floor(qty)) : 1;

      doc.title = String(title ?? doc.title).trim();
      doc.brand = String(brand ?? doc.brand).trim();
      doc.ram = String(ram ?? doc.ram).trim();
      doc.disk = String(disk ?? doc.disk).trim();
      doc.storage = String(storage ?? doc.storage).trim();
      doc.description = String(description ?? doc.description).trim();
      doc.price = Number.isFinite(priceNum) ? priceNum : doc.price;
      doc.quantity = safeQty;
      doc.category = category ? String(category).trim() : doc.category;
      doc.subCategory = subCategory ? String(subCategory).trim() : doc.subCategory;
      doc.type = String(type ?? doc.type).trim();
      doc.stockStatus = stockStatus
        ? String(stockStatus).trim()
        : doc.stockStatus || "In stock";
      doc.images = images;
      if (specsRaw !== undefined) {
        doc.specs = parseSpecs(specsRaw);
      }

      await doc.save();
      res.json(doc);
    } catch (err) {
      if (err.name === "ValidationError") {
        return res.status(400).json({ message: err.message });
      }
      next(err);
    }
  }
);

router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const doc = await Listing.findByIdAndDelete(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: "Listing not found." });
    }
    res.json({ ok: true, id: doc._id });
  } catch (err) {
    next(err);
  }
});

export default router;
