const mongoose = require("mongoose");
const { Schema } = mongoose;

const listingSchema = new Schema({
  title: {
    type: String,
    required: true,
  },
  slug: {
    type: String,
    required: true,
  },
  brand: {
    type: String,
    required: true,
  },
  ram: {
    type: String,
    required: true,
  },
  disk: {
    type: String,
    required: true,
  },
  storage: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
    minLength: 10,
    maxLength: 100,
  },
  images: {
    type: Array,
    default:
      "https://images.pexels.com/photos/18105/pexels-photo.jpg?_gl=1*13syg5p*_ga*MzIzMTYzMjcyLjE3NzI1NTk2NTM.*_ga_8JE65Q40S6*czE3NzI1NTk2NTIkbzEkZzEkdDE3NzI1NTk3NzEkajUxJGwwJGgw",
  },
  price: {
    type: Number,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
});

const Listing = mongoose.model("Listing", listingSchema);
module.exports = Listing;
