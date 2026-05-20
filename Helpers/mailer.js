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

  const brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) {
    await sendBrevoEmail({
      apiKey: brevoKey,
      to,
      subject: subject || "Your OTP code",
      html,
    });
    return;
  }

  const transporter = getMailer();
  try {
    await transporter.sendMail({ from, to, subject: subject || "Your OTP code", html });
  } catch (err) {
    console.error("SMTP sendMail failed:", err);
    throw err;
  }
}

async function sendBrevoEmail({ apiKey, to, subject, html }) {
  const fromEmail =
    process.env.SMTP_FROM || process.env.BREVO_FROM || process.env.SMTP_USER;
  if (!fromEmail) {
    throw new Error("SMTP_FROM (or BREVO_FROM) must be set in the server environment.");
  }
  const senderName = process.env.BREVO_FROM_NAME || "OrakiTech";

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: senderName, email: fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Brevo sendMail failed:", res.status, text);
    throw new Error(text || "Brevo sendMail failed.");
  }
}
