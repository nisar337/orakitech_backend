import { Schema, model } from "mongoose";

const listingSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true
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
      maxLength: 2000,
    },
    images: [
      {
        url: {
          type: String,
          required: true
        },
        filename: {
          type: String,
          required: true
        }
      }
    ],
    price: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: ["Normal", "Moderate", "Gaming", "High Performance"],
    },
    type: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    stockStatus: {
      type: String,
      enum: ["In stock", "Out of stock"],
      default: "In stock",
    },
    /** Extra rows for the product page spec table (e.g. Processor, Display). */
    specs: {
      type: [
        {
          label: { type: String, required: true, trim: true, maxlength: 120 },
          value: { type: String, required: true, trim: true, maxlength: 500 },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

const Listing = model("Listing", listingSchema);
export default Listing;
