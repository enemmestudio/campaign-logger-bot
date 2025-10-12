// index.js
const express = require('express');
const app = express();

app.use(express.json()); // parse JSON bodies

// --- helper to build the dialog card response ---
function buildDialogResponse() {
  return {
    actionResponse: {
      type: "DIALOG",
      dialogAction: {
        dialog: {
          title: "Log Positive Response",
          body: {
            sections: [
              {
                widgets: [
                  { textInput: { label: "Prospect Name", name: "prospectName" } },
                  { textInput: { label: "Email", name: "email" } },
                  { textInput: { label: "Response (copy/paste)", name: "response", multiline: true } }
                ]
              }
            ],
            fixedFooter: {
              primaryButton: {
                text: "Submit",
                // This instructs Chat to send a CARD_CLICKED event with an action
                onClick: { action: { actionMethodName: "handleSubmit" } }
              },
              secondaryButton: {
                text: "Cancel",
                onClick: { action: { actionMethodName: "handleCancel" } }
              }
            }
          }
        }
      }
    }
  };
}

// --- helper to build a plain message response ---
function textResponse(text) {
  return { text: text };
}

// --- main webhook handler ---
app.post('/', (req, res) => {
  // Debug logging (safe for initial debugging)
  try {
    console.log('==== INCOMING EVENT ====', new Date().toISOString());
    console.log('HEADERS:', JSON.stringify(req.headers));
    // Limit body size in logs to avoid huge prints
    console.log('BODY:', JSON.stringify(req.body).slice(0, 8000));
  } catch (e) {
    console.error('Error logging request', e);
  }

  const event = req.body || {};
  const eventType = event.type;

  // When the bot is added to a space
  if (eventType === 'ADDED_TO_SPACE') {
    return res.json(textResponse("🤖 Campaign Logger Bot added! Type /positive or say 'hi' to open the form."));
  }

  // When the bot receives a normal message
  if (eventType === 'MESSAGE') {
    // Google Chat sometimes uses message.argumentText for slash-style commands
    const rawText = (event.message && (event.message.argumentText || event.message.text)) || '';
    const text = String(rawText).toLowerCase().trim();

    // triggers to open the dialog
    if (text === '/positive' || text.includes('positive') || text === 'hi' || text === 'hello') {
      // return the dialog action which will open the form in the client
      return res.json(buildDialogResponse());
    }

    // fallback message
    return res.json(textResponse("Got your message — type /positive or 'hi' to open the form."));
  }

  // When user clicks a card button or submits a dialog
  // Chat sends CARD_CLICKED and the submitted form is in event.action
  if (eventType === 'CARD_CLICKED') {
    try {
      // event.action carries action details (parameters etc.)
      const action = event.action || {};
      const actionMethod = action.actionMethodName || (action.actionMethod && action.actionMethod.name) || '';

      // If user clicked Submit (we named the actionMethodName "handleSubmit")
      if (actionMethod === 'handleSubmit') {
        // Form data may be in action.parameters (array of {key, value}) or in event.common.formInputs for Apps Script style.
        // Google Chat native cards often provide action.parameters
        let formData = {};

        if (Array.isArray(action.parameters)) {
          action.parameters.forEach(p => {
            // p has { key, value }
            if (p.key) formData[p.key] = p.value;
          });
        }

        // Some clients may present form inputs differently; try safe extraction:
        if (event.common && event.common.formInputs) {
          // Apps Script style formInputs: each key -> stringInputs.value array
          try {
            Object.keys(event.common.formInputs).forEach(k => {
              const v = event.common.formInputs[k];
              if (v && v.stringInputs && v.stringInputs.value) {
                formData[k] = v.stringInputs.value[0] || '';
              }
            });
          } catch (e) {
            // ignore if shape differs
          }
        }

        console.log('Form submission data:', formData);

        // TODO: Here you could write `formData` to a Google Sheet using Google APIs (requires OAuth).
        // For now return a friendly confirmation message back to the chat.

        const name = formData.prospectName || formData['prospectName'] || '-';
        const email = formData.email || '-';
        const responseText = formData.response || '-';

        const confirmText = `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`;

        return res.json(textResponse(confirmText));
      }

      // handle Cancel click
      if (actionMethod === 'handleCancel') {
        return res.json(textResponse('❌ Cancelled logging.'));
      }

      // Unknown CARD_CLICKED action
      console.log('CARD_CLICKED unknown action:', actionMethod);
      return res.json(textResponse('Action received.'));
    } catch (err) {
      console.error('Error handling CARD_CLICKED', err);
      return res.json(textResponse('⚠️ Error processing action.'));
    }
  }

  // default fallback for any event types we didn't explicitly handle
  return res.json(textResponse('diagnostic: event received'));
});

// Health check endpoint
app.get('/healthz', (req, res) => res.send('OK'));

// Start server
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server listening on port ${port}`));
