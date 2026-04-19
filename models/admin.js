import { Schema, model } from "mongoose";

const adminSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 2,
      maxlength: 64,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    fullName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120,
    },
    email: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120,
    },
    active: {
      type: Boolean,
      default: true,
    },
    /** Exactly one primary admin — cannot be deleted via API. */
    isPrimary: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export default model("Admin", adminSchema);
