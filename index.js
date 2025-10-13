// index.js
// Simple Express app to handle Google Chat events and return dialog JSON.
// Works for: slash command -> REQUEST_DIALOG, message events, and dialog submits.

const express = require('express');

const app = express();
app.use(express.json({ limit: '1mb' }));


// --------------------------- Helper responses -----------------------------
function textResponse(text) {
  return { text };
}

// Builds the dialog JSON Google Chat expects (actionResponse: DIALOG).
// You can customize the dialog body/widgets here.
function buildDialogResponse() {
  // actionResponse + cardsV2 is a good fallback for modern clients.
  const dialog = {
    actionResponse: {
      type: 'DIALOG',
      dialogAction: {
        dialog: {
          title: 'Log Positive Response',
          body: {
            sections: [
              {
                widgets: [
                  { textInput: { label: 'Prospect Name', name: 'prospectName' } },
                  { textInput: { label: 'Email', name: 'email' } },
                  {
                    textInput: {
                      label: 'Response (copy/paste)',
                      name: 'response',
                      multiline: true
                    }
                  }
                ]
              }
            ],
            fixedFooter: {
              primaryButton: {
                text: 'Submit',
                onClick: {
                  action: { actionMethodName: 'handleSubmit' }
                }
              },
              secondaryButton: {
                text: 'Cancel',
                onClick: {
                  action: { actionMethodName: 'handleCancel' }
                }
              }
            }
          }
        }
      }
    },
    // cardsV2 fallback view that Chat can render if DIALOG parsing differs
    cardsV2: [
      {
        cardId: 'dlg-fallback',
        card: {
          header: { title: 'Log Positive Response' },
          sections: [
            {
              widgets: [
                { textInput: { label: 'Prospect Name', name: 'prospectName' } },
                { textInput: { label: 'Email', name: 'email' } },
                {
                  textInput: {
                    label: 'Response (copy/paste)',
                    name: 'response',
                    multiline: true
                  }
                }
              ]
            }
          ],
          fixedFooter: {
            primaryButton: {
              text: 'Submit',
              onClick: { action: { actionMethodName: 'handleSubmit' } }
            },
            secondaryButton: {
              text: 'Cancel',
              onClick: { action: { actionMethodName: 'handleCancel' } }
            }
          }
        }
      }
    ]
  };

  return dialog;
}

// returns a success confirmation card/text after a submit
function buildSubmitResponse(summaryText) {
  // Basic text response (works everywhere)
  return textResponse(summaryText);
}

// --------------------------- Helpers: extract text & inputs ----------------
// Safely extract the raw incoming user text from multiple event shapes
function extractIncomingText(event) {
  // try common locations
  if (!event) return '';

  // If appCommandPayload (slash command / request dialog) contains message.text
  if (event.chat && event.chat.appCommandPayload && event.chat.appCommandPayload.message) {
    const m = event.chat.appCommandPayload.message;
    if (m.argumentText) return m.argumentText;
    if (m.text) return m.text;
  }

  // event.message.* (regular message)
  if (event.message) {
    if (event.message.argumentText) return event.message.argumentText;
    if (event.message.text) return event.message.text;
  }

  // direct top-level argumentText
  if (event.argumentText) return event.argumentText;

  return '';
}

// Extract form inputs after a dialog submit.
// Supports a few shapes:
// - event.action.parameters (array of {key, value})
// - event.action.inputs (object mapping keys)
// - event.inputs (object mapping keys) as seen in some dialog/submits
function extractFormValues(event) {
  const out = {};

  // 1) event.action.parameters -> [{ key, value }]
  if (event.action && Array.isArray(event.action.parameters)) {
    event.action.parameters.forEach(p => {
      if (p && p.key) out[p.key] = p.value || '';
    });
  }

  // 2) event.action.inputs -> object mapping (some clients)
  if (event.action && event.action.inputs && typeof event.action.inputs === 'object') {
    Object.assign(out, event.action.inputs);
  }

  // 3) event.inputs -> object mapping (dialog submit sometimes)
  if (event.inputs && typeof event.inputs === 'object') {
    Object.assign(out, event.inputs);
  }

  // 4) event.message.formInputs (older shape)
  if (event.message && event.message.formInputs) {
    // formInputs might be { fieldName: [{ text: 'value' }] } or similar
    Object.keys(event.message.formInputs).forEach(key => {
      const v = event.message.formInputs[key];
      if (Array.isArray(v) && v.length > 0 && typeof v[0].text === 'string') {
        out[key] = v[0].text;
      } else if (typeof v === 'string') {
        out[key] = v;
      } else if (v && typeof v === 'object' && v.value) {
        out[key] = v.value;
      }
    });
  }

  return out;
}

// --------------------------- Main webhook ---------------------------
app.post('/', (req, res) => {
  const event = req.body || {};
  console.log('==== INCOMING EVENT ====');
  console.log(JSON.stringify(event, null, 2));

  // sometimes Chat uses event.type or chat + appCommandPayload
  const eventType = (event.type || '').toUpperCase(); // e.g. 'MESSAGE', 'CARD_CLICKED', 'ADDED_TO_SPACE'

  // QUICK ROUTES:
  // 1) If this is an action (button clicked / dialog submit) -> event.action or card click
  if (event.action && event.action.actionMethodName) {
    const method = event.action.actionMethodName;
    console.log('Action methodName:', method);

    if (method === 'handleSubmit') {
      // parse submitted inputs
      const values = extractFormValues(event);
      const name = values.prospectName || values.prospectname || values['Prospect Name'] || '';
      const email = values.email || '';
      const responseText = values.response || values.Response || '';

      const summary = `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`;
      console.log('Submit values:', { name, email, responseText });

      // Respond to Chat with a confirmation message
      return res.json(buildSubmitResponse(summary));
    }

    if (method === 'handleCancel') {
      return res.json(textResponse('Cancelled.'));
    }

    // unknown action -> just ack
    return res.json(textResponse(`Action received: ${method}`));
  }

  // 2) Card clicked events sometimes come as type === 'CARD_CLICKED'
  if (eventType === 'CARD_CLICKED') {
    // card click can also contain event.action -> handled above
    return res.json(textResponse('Card clicked.'));
  }

  // 3) Dialog REQUEST event or slash command:
  // We'll check for appCommandPayload.isDialogEvent OR slash command metadata.
  const isDialogEvent =
    !!(event.chat && event.chat.appCommandPayload && event.chat.appCommandPayload.isDialogEvent) ||
    !!event.isDialogEvent ||
    (eventType === 'REQUEST_DIALOG') ||
    false;

  // Extract a safe text representation - handles regular message + appCommandPayload shapes
  const incomingText = extractIncomingText(event);
  const text = String(incomingText || '').toLowerCase().trim();

  // If it's a dialog request (Google sends this when your slash command triggers a dialog),
  // return the dialog JSON immediately.
  if (isDialogEvent || text === '/positive' || text === '/pos' || text === 'hi' || text.includes('/pos')) {
    console.log('→ Returning dialog JSON for:', { text, isDialogEvent });
    return res.json(buildDialogResponse());
  }

  // 4) Normal message fallback
  // You should respond quickly with a small text. Avoid long processing.
  console.log('→ Fallback text response');
  return res.json(textResponse("Got your message – type /positive or 'hi' to open the form."));
});

// Health check root GET so a browser visit doesn't show "Cannot GET /"
app.get('/', (req, res) => {
  res.send('OK - Google Chat bot endpoint is running.');
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
