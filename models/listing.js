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
      default: "",
    },
    disk: {
      type: String,
      default: "",
    },
    storage: {
      type: String,
      default: "",
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
    },
    subCategory: {
      type: String,
      required: true,
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

listingSchema.index({ createdAt: -1 });

const Listing = model("Listing", listingSchema);
export default Listing;
