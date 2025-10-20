// index.js
// Google Chat bot with secure authentication via Workload Identity Federation (Render + GCP)

import express from "express";
import bodyParser from "body-parser";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());

// Authenticate with Google automatically using environment variables
async function getGoogleChatClient() {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/chat.bot"],
  });
  const client = await auth.getClient();
  return google.chat({ version: "v1", auth: client });
}

// Helper to send message to a space/thread
async function sendMessageToSpace(spaceName, text, threadName = null) {
  try {
    const chat = await getGoogleChatClient();

    const message = { text };
    if (threadName) message.thread = { name: threadName };

    const res = await chat.spaces.messages.create({
      parent: spaceName,
      requestBody: message,
    });

    console.log("✅ Sent message to space:", res.data.name);
  } catch (err) {
    console.error("❌ Failed to send message:", err?.response?.data || err);
  }
}

// Main webhook handler
app.post("/", async (req, res) => {
  console.log("==== INCOMING EVENT ====");
  console.log(JSON.stringify(req.body, null, 2));

  const event = req.body;
  const spaceName =
    event?.chat?.message?.space?.name || event?.message?.space?.name;
  const threadName =
    event?.chat?.message?.thread?.name || event?.message?.thread?.name;
  const text =
    event?.chat?.message?.text || event?.message?.text || "hi";

  if (!spaceName) {
    console.error("No spaceName found in event");
    return res.sendStatus(400);
  }

  // Simple response
  const reply = `👋 Got your message: "${text}"`;

  // Reply using Chat API (authenticated)
  await sendMessageToSpace(spaceName, reply, threadName);

  // Acknowledge receipt to Chat (important!)
  res.sendStatus(200);
});

// Health check
app.get("/", (req, res) => {
  res.send("✅ TGA Chat Bot running successfully!");
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
