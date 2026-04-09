const initData = require("./data");
const mongoose = require("mongoose");
const Listing = require("../models/listing.js");
const generateSlug = require("../Helpers/slug-generators.js");

main()
  .then(() => {
    console.log("Connected to DB");
  })
  .catch((err) => {
    console.log("Error connecting to DB", err);
  });

async function main() {
  await mongoose.connect("mongodb://localhost:27017/Orakitech");
}

initData.map((data) => {
  const { title } = data;
  const slug = generateSlug(title);
  const listingData = new Listing({ ...data, slug });
  listingData.save();
});
