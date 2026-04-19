import jwt from "jsonwebtoken";

/**
 * Verifies Bearer JWT issued by POST /api/auth/admin/login.
 */
export function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 16) {
    return res.status(500).json({
      message:
        "Server misconfiguration: set ADMIN_JWT_SECRET (at least 16 characters).",
    });
  }
  const raw = req.headers.authorization || "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ message: "Missing or invalid authorization." });
  }
  try {
    const payload = jwt.verify(m[1], secret);
    if (payload.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired session." });
  }
}
