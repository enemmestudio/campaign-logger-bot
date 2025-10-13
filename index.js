// index.js
const express = require('express');
const app = express();

app.use(express.json({ limit: '1mb' })); // parse JSON bodies

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

function textResponse(text) {
  return { text: text };
}

// Helper: normalize incoming event so we can use unified logic
function normalizeEvent(raw) {
  // If the event already has a top-level "type", keep it
  const out = Object.assign({}, raw);

  if (!out.type) {
    // Older/newer Chat Add-on format — detect message payload from your logs:
    // - v2 shape has .chat.message or .chat.messagePayload
    if (raw.chat && (raw.chat.message || raw.chat.messagePayload)) {
      out.type = 'MESSAGE';
      // copy message into a familiar place used by existing code
      out.message = raw.chat.message || raw.chat.messagePayload.message || null;
      // For slash/argumentText support:
      if (raw.chat.message && raw.chat.message.argumentText) {
        out.message.argumentText = raw.chat.message.argumentText;
      } else if (raw.chat.messagePayload && raw.chat.messagePayload.message) {
        out.message.argumentText = raw.chat.messagePayload.message.argumentText || '';
      }
      // carry over common.formInputs if present
      out.common = raw.commonEventObject || raw.common || {};
      // carry action if present (CARD_CLICKED sometimes delivered differently)
      if (raw.action) out.action = raw.action;
    } else if (raw.message) {
      // already present
      out.type = raw.type || 'MESSAGE';
    } else if (raw.authorizationEventObject && raw.configCompleteRedirectUri) {
      // installation / config complete flow — treat as ADDED_TO_SPACE
      out.type = 'ADDED_TO_SPACE';
    } else if (raw.action) {
      out.type = 'CARD_CLICKED';
    }
  }

  return out;
}

// --- main webhook handler ---
app.post('/', (req, res) => {
  const raw = req.body || {};
  const event = normalizeEvent(raw);

  try {
    console.log('==== INCOMING EVENT ==== ', new Date().toISOString());
    console.log('HEADERS:', JSON.stringify(req.headers));
    // log the most relevant chunk of the body (avoid huge logs)
    console.log('BODY (truncated):', JSON.stringify(req.body).slice(0, 8000));
  } catch (e) {
    console.error('Error logging request', e);
  }

  const eventType = event.type;

  // When the bot is added to a space
  if (eventType === 'ADDED_TO_SPACE') {
    return res.json(textResponse("🤖 Campaign Logger Bot added! Type /positive or say 'hi' to open the form."));
  }

  // When the bot receives a normal message
  if (eventType === 'MESSAGE') {
    // Support both shapes:
    // - event.message.argumentText (slash commands)
    // - event.message.text
    // - event.chat.message (we copied that earlier in normalizeEvent)
    const rawText = (event.message && (event.message.argumentText || event.message.text)) || '';
    const text = String(rawText).toLowerCase().trim();

    // triggers to open the dialog
    if (text === '/positive' || text.includes('positive') || text === 'hi' || text === 'hello') {
      return res.json(buildDialogResponse());
    }

    // fallback message
    return res.json(textResponse("Got your message — type /positive or 'hi' to open the form."));
  }

  // When user clicks a card button or submits a dialog
  if (eventType === 'CARD_CLICKED') {
    try {
      const action = event.action || {};
      // Action name might be in different places
      const actionMethod = action.actionMethodName || (action.actionMethod && action.actionMethod.name) || '';

      if (actionMethod === 'handleSubmit') {
        let formData = {};

        if (Array.isArray(action.parameters)) {
          action.parameters.forEach(p => {
            if (p.key) formData[p.key] = p.value;
          });
        }

        if (event.common && event.common.formInputs) {
          try {
            Object.keys(event.common.formInputs).forEach(k => {
              const v = event.common.formInputs[k];
              if (v && v.stringInputs && v.stringInputs.value) {
                formData[k] = v.stringInputs.value[0] || '';
              }
            });
          } catch (e) { /* ignore */ }
        }

        console.log('Form submission data:', formData);

        const name = formData.prospectName || formData['prospectName'] || '-';
        const email = formData.email || '-';
        const responseText = formData.response || '-';

        const confirmText = `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`;

        return res.json(textResponse(confirmText));
      }

      if (actionMethod === 'handleCancel') {
        return res.json(textResponse('❌ Cancelled logging.'));
      }

      console.log('CARD_CLICKED unknown action:', actionMethod);
      return res.json(textResponse('Action received.'));
    } catch (err) {
      console.error('Error handling CARD_CLICKED', err);
      return res.json(textResponse('⚠️ Error processing action.'));
    }
  }

  // default fallback for anything else
  return res.json(textResponse('diagnostic: event received'));
});

// Health check endpoint
app.get('/healthz', (req, res) => res.send('OK'));

// Start server
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server listening on port ${port}`));
