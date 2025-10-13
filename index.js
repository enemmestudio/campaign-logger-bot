// index.js
const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root and health endpoints so the service is discoverable in a browser
app.get('/', (req, res) => {
  res.send('Campaign Logger Bot is running.');
});
app.get('/healthz', (req, res) => res.send('OK'));

// Helper — plain text response
function textResponse(text) {
  return { text };
}

// Helper — well-formed dialog + cardsV2 fallback
function buildDialogResponse() {
  const dialog = {
    actionResponse: {
      type: "DIALOG",
      dialogAction: {
        dialog: {
          title: "Log Positive Response",
          body: {
            sections: [
              {
                header: "Log Positive Response",
                widgets: [
                  {
                    textInput: {
                      label: "Prospect Name",
                      name: "prospectName",
                      type: "SINGLE_LINE"
                    }
                  },
                  {
                    textInput: {
                      label: "Email",
                      name: "email",
                      type: "SINGLE_LINE"
                    }
                  },
                  {
                    textInput: {
                      label: "Response (copy/paste)",
                      name: "response",
                      type: "MULTIPLE_LINE"
                    }
                  }
                ]
              }
            ]
          },
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
    },
    // Add a cardsV2 fallback and a small text to improve compatibility with various clients
    cardsV2: [
      {
        cardId: "dlg-fallback",
        card: {
          header: { title: "Log Positive Response" },
          sections: [
            {
              widgets: [
                { textInput: { label: "Prospect Name", name: "prospectName", type: "SINGLE_LINE" } },
                { textInput: { label: "Email", name: "email", type: "SINGLE_LINE" } },
                { textInput: { label: "Response (copy/paste)", name: "response", type: "MULTIPLE_LINE" } }
              ]
            }
          ],
          fixedFooter: {
            primaryButton: { text: "Submit", onClick: { action: { actionMethodName: "handleSubmit" } } },
            secondaryButton: { text: "Cancel", onClick: { action: { actionMethodName: "handleCancel" } } }
          }
        }
      }
    ],
    text: "Opening the positive-response form..."
  };

  return dialog;
}

// Main webhook handler
app.post('/', (req, res) => {
  try {
    console.log('==== INCOMING EVENT ====', new Date().toISOString());
    console.log('HEADERS:', JSON.stringify(req.headers));
    // Avoid huge logs; stringify limited body preview
    try { console.log('BODY (preview):', JSON.stringify(req.body).slice(0, 10000)); } catch(e) {}

    const event = req.body || {};
    const eventType = event.type || (event.commonEventObject ? 'MESSAGE' : '');

    // ADDED_TO_SPACE
    if (eventType === 'ADDED_TO_SPACE') {
      return res.json(textResponse("🤖 Campaign Logger Bot added! Type /positive or say 'hi' to open the form."));
    }

    // MESSAGE
    if (eventType === 'MESSAGE' || eventType === 'NORMAL_MESSAGE' || event.chat) {
      const rawText = (event.message && (event.message.argumentText || event.message.text)) || (event.argumentText) || '';
      const text = String(rawText).toLowerCase().trim();

      if (text === '/positive' || text === '/pos' || text.includes('positive') || text === 'hi' || text === 'hello') {
        return res.json(buildDialogResponse());
      }

      return res.json(textResponse("Got your message — type /positive or 'hi' to open the form."));
    }

    // CARD_CLICKED (form submit or button)
    if (eventType === 'CARD_CLICKED') {
      try {
        console.log('CARD_CLICKED event:', JSON.stringify(event).slice(0, 8000));
        const action = event.action || {};
        const actionMethod = action.actionMethodName || (action.actionMethod && action.actionMethod.name) || '';

        if (actionMethod === 'handleSubmit') {
          const formData = {};
          if (Array.isArray(action.parameters)) {
            action.parameters.forEach(p => { if (p.key) formData[p.key] = p.value; });
          }
          if (event.common && event.common.formInputs) {
            Object.keys(event.common.formInputs).forEach(k => {
              const v = event.common.formInputs[k];
              if (v && v.stringInputs && v.stringInputs.value) {
                formData[k] = v.stringInputs.value[0] || '';
              } else if (v && v.selectionInput && v.selectionInput.selectedValues) {
                formData[k] = v.selectionInput.selectedValues.join(', ');
              }
            });
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

        // Unknown action
        console.log('Unknown CARD_CLICKED action:', actionMethod);
        return res.json(textResponse('Action received.'));
      } catch (err) {
        console.error('Error handling CARD_CLICKED', err);
        return res.json(textResponse('⚠️ Error processing action.'));
      }
    }

    // Fallback
    return res.json(textResponse('diagnostic: event received'));
  } catch (err) {
    console.error('Unhandled error in POST / handler', err);
    // Return plain error so client doesn't keep spinning without a response
    return res.status(500).json(textResponse('Server error processing request.'));
  }
});

// Start server
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server listening on port ${port}`));
