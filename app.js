import "dotenv/config";
import dns from "node:dns";

// Windows + Node often fail querySrv (ECONNREFUSED) for mongodb+srv when the
// system's first DNS server refuses SRV lookups. Prefer explicit resolvers.
const fromEnv = process.env.DNS_SERVERS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const dnsServers =
  fromEnv?.length > 0
    ? fromEnv
    : process.platform === "win32"
      ? ["8.8.8.8", "8.8.4.4"]
      : null;
if (dnsServers?.length) {
  dns.setServers(dnsServers);
}

import express from "express";
import mongoose from "mongoose";
import homeRoute from "./Routing/homeRoute.js";
import listingRoute from "./Routing/listingRoute.js";
import orderRoute from "./Routing/orderRoute.js";
import authRoute from "./Routing/authRoute.js";
import engagementRoute from "./Routing/engagementRoute.js";
import aboutRoute from "./Routing/aboutRoute.js";

const app = express();
import cors from "cors";

const PORT = process.env.PORT || 3002;
const dbUrl = process.env.ATLASDB_URL;

/** Comma-separated origins for browser requests (Vercel preview + production). */
const corsOrigins = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

app.use(express.json());
app.use(
  cors({
    origin:
      corsOrigins && corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


main()
  .then(() => {
    console.log("Connected to DB");
  })
  .catch((err) => {
    console.log("Error connecting to DB", err);
  });

async function main() {
  await mongoose.connect(dbUrl);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "orakitech-api" });
}); 


app.use("/api/auth", authRoute);
app.use("/api/home", homeRoute);
app.use("/api/listings", listingRoute);
app.use("/api/orders", orderRoute);
app.use("/api/engagement", engagementRoute);
app.use("/api/about", aboutRoute);


app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || "Server error";
  res.status(status).json({ message });
});

app.listen(PORT, () => {
  console.log("Server Listening");
  if (
    !process.env.ADMIN_JWT_SECRET ||
    String(process.env.ADMIN_JWT_SECRET).length < 16
  ) {
    console.warn(
      "[admin] Set ADMIN_JWT_SECRET (16+ chars) in .env. Create the first admin via POST /api/auth/admin/setup or the dashboard setup form."
    );
  }
});
