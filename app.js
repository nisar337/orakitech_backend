const express = require("express");
const Listing = require("./models/listing");
const mongoose = require("mongoose");
const app = express();
const CORS = require("cors");

// Middlewares
app.use(express.json());
app.use(CORS());

main()
  .then(() => {
    console.log("Connected to DB");
  })
  .catch((err) => {
    console.log("Error connecting to DB", err);
  });

// Database Cononection function
async function main() {
  await mongoose.connect("mongodb://localhost:27017/Orakitech");
}

// Get Request for Query Item
app.get("/api/home/:queryParams", async (req, res, next) => {
  const { queryParams } = req.params;
  const result = await Listing.findOne({ slug: queryParams });
  if (!result) {
    return res.status(500).json({ message: "Result not found!" });
  }
  res.send(result);
});

// Get Request for Home Route 
app.get("/api/home", async (req, res, next) => {
  const laptopData = await Listing.find();
  if (!laptopData) {
    return res.status(500).json({ message: "Data not found!" });
  }
  res.send(laptopData);
});

// Error handling Middleware
app.use((err, req, res, next) => {
  const { status = 500, message = "Page not found!" } = err;
  res.status(status).json({ message });
});

app.listen(3002, () => {
  console.log("Server Listening");
});
