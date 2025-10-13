// index.js
const express = require("express");
const app = express();
app.use(express.json());

// Respond to Chat messages
app.post("/", async (req, res) => {
  console.log("==== INCOMING EVENT ====", new Date().toISOString());
  const body = req.body || {};
  console.log(JSON.stringify(body, null, 2));

  try {
    const text = body?.chat?.messagePayload?.message?.text?.toLowerCase() || "";

    // ✅ When user says "hi" or "/positive" show the dialog
    if (text === "hi" || text === "/positive") {
      const dialogResponse = {
        actionResponse: {
          type: "DIALOG",
          dialogAction: {
            dialog: {
              body: {
                sections: [
                  {
                    header: "Log Positive Response",
                    widgets: [
                      {
                        textInput: {
                          label: "Prospect Name",
                          name: "prospectName",
                        },
                      },
                      {
                        textInput: {
                          label: "Email",
                          name: "email",
                        },
                      },
                      {
                        textInput: {
                          label: "Response (copy/paste)",
                          name: "response",
                          multiline: true,
                        },
                      },
                    ],
                  },
                ],
              },
              fixedFooter: {
                primaryButton: {
                  text: "Submit",
                  onClick: {
                    action: {
                      actionMethodName: "handleSubmit",
                    },
                  },
                },
                secondaryButton: {
                  text: "Cancel",
                  onClick: {
                    action: {
                      actionMethodName: "handleCancel",
                    },
                  },
                },
              },
            },
          },
        },
        text: "Opening the positive-response form...",
      };
      console.log("==== RESPONSE SENT ====");
      return res.json(dialogResponse);
    }

    // ✅ When user submits the form
    if (body.action && body.action.actionMethodName === "handleSubmit") {
      const form = body.common?.formInputs || {};
      const name = form.prospectName?.stringInputs?.value?.[0] || "";
      const email = form.email?.stringInputs?.value?.[0] || "";
      const response = form.response?.stringInputs?.value?.[0] || "";

      return res.json({
        text: `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${response}`,
      });
    }

    // ✅ Cancel button
    if (body.action && body.action.actionMethodName === "handleCancel") {
      return res.json({ text: "❌ Cancelled logging." });
    }

    // Default fallback
    return res.json({
      text: "Hi there 👋 — type `/positive` or say `hi` to open the form.",
    });
  } catch (err) {
    console.error("Error:", err);
    return res.json({ text: "⚠️ Something went wrong." });
  }
});

// Health endpoint
app.get("/", (req, res) => res.send("OK"));

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
