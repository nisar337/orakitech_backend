import { Router } from "express";
import mongoose from "mongoose";
import Listing from "../models/listing.js";
import Review from "../models/review.js";
import ProductQuestion from "../models/productQuestion.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = Router();

async function assertListing(listingId) {
  if (!mongoose.Types.ObjectId.isValid(listingId)) {
    return { error: { status: 400, message: "Invalid product id." } };
  }
  const exists = await Listing.exists({ _id: listingId });
  if (!exists) {
    return { error: { status: 404, message: "Product not found." } };
  }
  return {};
}

/** Reviews + aggregate rating */
router.get("/listings/:listingId/reviews", async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const bad = await assertListing(listingId);
    if (bad.error) return res.status(bad.error.status).json({ message: bad.error.message });

    const reviews = await Review.find({ listingId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const agg = await Review.aggregate([
      { $match: { listingId: new mongoose.Types.ObjectId(listingId) } },
      {
        $group: {
          _id: null,
          avg: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ]);

    const averageRating =
      agg[0]?.avg != null ? Math.round(agg[0].avg * 10) / 10 : null;
    const count = agg[0]?.count ?? 0;

    res.json({ reviews, averageRating, count });
  } catch (err) {
    next(err);
  }
});

router.post("/listings/:listingId/reviews", async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const bad = await assertListing(listingId);
    if (bad.error) return res.status(bad.error.status).json({ message: bad.error.message });

    const rating = Math.round(Number(req.body?.rating));
    const comment = String(req.body?.comment || "").trim();
    const authorName = String(req.body?.authorName || "").trim().slice(0, 80);

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Please select a star rating from 1 to 5." });
    }
    if (comment.length < 3) {
      return res.status(400).json({ message: "Please write a comment (at least 3 characters)." });
    }

    const doc = await Review.create({
      listingId,
      rating,
      comment,
      authorName: authorName || "Anonymous",
    });

    res.status(201).json({
      ok: true,
      review: doc.toObject(),
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
});

/** Questions (public read / ask) */
router.get("/listings/:listingId/questions", async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const bad = await assertListing(listingId);
    if (bad.error) return res.status(bad.error.status).json({ message: bad.error.message });

    const questions = await ProductQuestion.find({ listingId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ questions });
  } catch (err) {
    next(err);
  }
});

router.post("/listings/:listingId/questions", async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const bad = await assertListing(listingId);
    if (bad.error) return res.status(bad.error.status).json({ message: bad.error.message });

    const question = String(req.body?.question || "").trim();
    const authorName = String(req.body?.authorName || "").trim().slice(0, 80);

    if (question.length < 3) {
      return res.status(400).json({ message: "Please enter a question (at least 3 characters)." });
    }

    const doc = await ProductQuestion.create({
      listingId,
      question,
      authorName: authorName || "Anonymous",
    });

    res.status(201).json({ ok: true, question: doc.toObject() });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
});

/** Admin: post an official answer to a question */
router.put("/questions/:questionId/answer", requireAdmin, async (req, res, next) => {
  try {
    const { questionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ message: "Invalid question id." });
    }
    const answer = String(req.body?.answer || "").trim();
    if (answer.length < 1) {
      return res.status(400).json({ message: "Answer cannot be empty." });
    }

    const doc = await ProductQuestion.findByIdAndUpdate(
      questionId,
      { answer: answer.slice(0, 2000), answeredAt: new Date() },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({ message: "Question not found." });
    }

    res.json({ ok: true, question: doc.toObject() });
  } catch (err) {
    next(err);
  }
});

export default router;
