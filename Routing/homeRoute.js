import { Router } from "express";
import Listing from "../models/listing.js";

const router = Router()

router.get("/", async (_req, res, next) => {
    try {
        const laptopData = await Listing.find()
            .sort({ createdAt: -1 })
            .select("title slug brand price category type images")
            .lean();
        res.send(laptopData);
    } catch (err) {
        next(err);
    }
});



router.get("/:queryParams", async (req, res, next) => {
    try {
        const { queryParams } = req.params;
        const result = await Listing.findOne({ slug: queryParams });
        if (!result) {
            return res.status(404).json({ message: "Result not found!" });
        }
        res.send(result);
    } catch (err) {
        next(err);
    }
});


export default router;