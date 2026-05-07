import { Schema, model } from "mongoose";

const orderItemSchema = new Schema(
  {
    listingId: { type: Schema.Types.ObjectId, ref: "Listing" },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    items: { type: [orderItemSchema], required: true },
    source: {
      type: String,
      enum: ["buy_now", "cart_checkout"],
      required: true,
    },
    totalUSD: { type: Number, required: true },
    customer: {
      fullName: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      address: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      country: { type: String, required: true, trim: true },
      notes: { type: String, trim: true, default: "" },
    },
    paymentMethod: {
      type: String,
      enum: ["cod"],
      required: true,
    },
    status: { type: String, default: "new" },
  },
  { timestamps: true }
);

const Order = model("Order", orderSchema);
export default Order;
