import { Schema, model } from "mongoose";

const reviewSchema = new Schema(
  {
    listingId: {
      type: Schema.Types.ObjectId,
      ref: "Listing",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 2000,
    },
    authorName: {
      type: String,
      trim: true,
      default: "Anonymous",
      maxlength: 80,
    },
  },
  { timestamps: true }
);

export default model("Review", reviewSchema);
