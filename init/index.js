const initData = require("./data");
const mongoose = require("mongoose");
const Listing = require("../models/listing.js");
const generateSlug = require("../Helpers/slug-generators.js");

async function run() {
  await mongoose.connect("mongodb://localhost:27017/Orakitech");
  console.log("Connected to DB");

  for (const data of initData) {
    const { title } = data;
    const slug = generateSlug(title);
    const listingData = new Listing({
      ...data,
      slug,
      disk: data.disk || "SSD (Solid State Drive)",
      category: data.category || "General",
      type: data.type || "New",
      quantity: data.quantity ?? 1,
    });
    await listingData.save();
  }
  console.log("Seed complete");
}

run().catch((err) => {
  console.log("Init error", err);
  process.exitCode = 1;
});
