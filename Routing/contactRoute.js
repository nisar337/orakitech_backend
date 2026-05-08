import express from "express";
import ContactMessage from "../models/contactMessage.js";

const router = express.Router();

/** POST /api/contact — submit a contact form message (public) */
router.post("/", async (req, res, next) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ message: "Name, email, subject, and message are required." });
    }

    const contactMessage = await ContactMessage.create({
      name,
      email,
      phone,
      subject,
      message,
    });

    res.status(201).json({ message: "Message sent successfully!", contactMessage });
  } catch (err) {
    next(err);
  }
});

/** GET /api/contact — get all contact messages (admin) */
router.get("/", async (req, res, next) => {
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/contact/:id/reply — save admin reply to a message */
router.patch("/:id/reply", async (req, res, next) => {
  try {
    const { replyText, repliedBy } = req.body;

    if (!replyText || !replyText.trim()) {
      return res.status(400).json({ message: "Reply text is required." });
    }

    const message = await ContactMessage.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    message.reply = {
      text: replyText.trim(),
      repliedAt: new Date(),
      repliedBy: repliedBy || "Admin",
    };
    await message.save();

    res.json({ message: "Reply saved successfully.", contactMessage: message });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/contact/:id — mark message as read (admin) */
router.put("/:id", async (req, res, next) => {
  try {
    const message = await ContactMessage.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    message.isRead = true;
    await message.save();

    res.json(message);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/contact/:id — delete a message (admin) */
router.delete("/:id", async (req, res, next) => {
  try {
    const message = await ContactMessage.findByIdAndDelete(req.params.id);
    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    res.json({ message: "Message deleted successfully." });
  } catch (err) {
    next(err);
  }
});

export default router;
