import { Schema, model } from "mongoose";

const productQuestionSchema = new Schema(
  {
    listingId: {
      type: Schema.Types.ObjectId,
      ref: "Listing",
      required: true,
      index: true,
    },
    question: {
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
    answer: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000,
    },
    answeredAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

export default model("ProductQuestion", productQuestionSchema);
