import nodemailer from "nodemailer";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the server environment.`);
  }
  return value;
}

let cachedTransport = null;

export function getMailer() {
  if (cachedTransport) return cachedTransport;
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false") === "true";
  const user = requireEnv("SMTP_USER");
  const pass = requireEnv("SMTP_PASS");

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return cachedTransport;
}

export async function sendOtpEmail({ to, otpCode, name, subject }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const safeName = name ? String(name).trim() : "";
  const greeting = safeName ? `Hi ${safeName},` : "Hi there,";

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
      <h2 style="margin: 0 0 12px;">${subject || "Verify your action"}</h2>
      <p>${greeting} Use the OTP below. It expires in 5 minutes.</p>
      <div style="font-size: 24px; font-weight: 700; letter-spacing: 4px; margin: 16px 0;">${otpCode}</div>
      <p style="margin: 0; color: #475569;">If you did not request this, you can ignore this email.</p>
    </div>
  `;

  const transporter = getMailer();
  try {
    await transporter.sendMail({ from, to, subject: subject || "Your OTP code", html });
  } catch (err) {
    console.error("SMTP sendMail failed:", err);
    throw err;
  }
}
