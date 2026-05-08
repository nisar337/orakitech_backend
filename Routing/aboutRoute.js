import express from "express";
import AboutContent from "../models/aboutContent.js";

const router = express.Router();

/** GET /api/about/public — get about page content (public) */
router.get("/public", async (req, res, next) => {
  try {
    const content = await AboutContent.getSingleton();
    res.json(content);
  } catch (err) {
    next(err);
  }
});

/** GET /api/about — get about page content (admin) */
router.get("/", async (req, res, next) => {
  try {
    const content = await AboutContent.getSingleton();
    res.json(content);
  } catch (err) {
    next(err);
  }
});

/** PUT /api/about — update about page content (admin) */
router.put("/", async (req, res, next) => {
  try {
    const {
      heroTitle,
      heroDescription,
      missionTitle,
      missionDescription,
      visionTitle,
      visionDescription,
      whyChooseUsTitle,
      features,
      ctaTitle,
      ctaDescription,
    } = req.body;

    const content = await AboutContent.getSingleton();

    if (heroTitle !== undefined) content.heroTitle = heroTitle;
    if (heroDescription !== undefined) content.heroDescription = heroDescription;
    if (missionTitle !== undefined) content.missionTitle = missionTitle;
    if (missionDescription !== undefined) content.missionDescription = missionDescription;
    if (visionTitle !== undefined) content.visionTitle = visionTitle;
    if (visionDescription !== undefined) content.visionDescription = visionDescription;
    if (whyChooseUsTitle !== undefined) content.whyChooseUsTitle = whyChooseUsTitle;
    if (features !== undefined) content.features = features;
    if (ctaTitle !== undefined) content.ctaTitle = ctaTitle;
    if (ctaDescription !== undefined) content.ctaDescription = ctaDescription;

    await content.save();
    res.json(content);
  } catch (err) {
    next(err);
  }
});

export default router;
