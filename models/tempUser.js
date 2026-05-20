import mongoose from "mongoose";

const tempUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    phone: { type: String, trim: true, default: "", maxlength: 32 },
    passwordHash: { type: String, required: true, select: false },
    otpHash: { type: String, required: true, select: false },
    otpExpiresAt: { type: Date, required: true },
    attemptCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

tempUserSchema.index({ otpExpiresAt: 1 }, { expireAfterSeconds: 0 });
tempUserSchema.index({ email: 1 }, { unique: true });

const TemporaryUser = mongoose.model("TemporaryUser", tempUserSchema);

export default TemporaryUser;
