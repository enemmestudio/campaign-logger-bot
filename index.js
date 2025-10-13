// index.js
const express = require('express');
const app = express();

app.use(express.json({ limit: '10mb' }));

function buildDialogPayload() {
  const dialogCard = {
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
    },
    // cardsV2 fallback (modern clients prefer this)
    cardsV2: [
      {
        cardId: "dialog-cardsv2",
        card: {
          header: { title: "Log Positive Response" },
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
    ],
    text: "Opening the positive-response form..."
  };

  return dialogCard;
}

function textResponse(text) {
  return { text };
}

app.post('/', (req, res) => {
  try {
    console.log('==== INCOMING EVENT ====', new Date().toISOString());
    console.log('HEADERS:', JSON.stringify(req.headers));
    console.log('BODY:', JSON.stringify(req.body).slice(0, 12000));

    const event = req.body || {};
    const eventType = (event.type || event.commonEventObject && event.commonEventObject.type || '').toString().toUpperCase();

    // ADDED_TO_SPACE events sometimes arrive as ADDED_TO_SPACE or as a message with subtype
    if (eventType === 'ADDED_TO_SPACE' || (eventType === '' && event.type === 'ADDED_TO_SPACE')) {
      return res.json(textResponse("🤖 Campaign Logger Bot added! Type /positive or say 'hi' to open the form."));
    }

    // MESSAGE
    if (eventType === 'MESSAGE' || (event.message && event.message.text)) {
      const rawText = (event.message && (event.message.argumentText || event.message.text)) || '';
      const text = String(rawText).toLowerCase().trim();

      if (text === '/positive' || text.includes('positive') || text === 'hi' || text === 'hello') {
        // return dialog + cardsV2 payload for compatibility
        return res.json(buildDialogPayload());
      }

      return res.json(textResponse("Got your message — type /positive or say 'hi' to open the form."));
    }

    // CARD_CLICKED
    if (eventType === 'CARD_CLICKED' || event.action) {
      try {
        const action = event.action || {};
        const actionMethod = action.actionMethodName || (action.actionMethod && action.actionMethod.name) || '';

        if (actionMethod === 'handleSubmit') {
          let formData = {};
          if (Array.isArray(action.parameters)) {
            action.parameters.forEach(p => { if (p.key) formData[p.key] = p.value; });
          }
          if (event.common && event.common.formInputs) {
            Object.keys(event.common.formInputs).forEach(k => {
              const v = event.common.formInputs[k];
              if (v && v.stringInputs && v.stringInputs.value) {
                formData[k] = v.stringInputs.value[0] || '';
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

        return res.json(textResponse('Action received.'));
      } catch (err) {
        console.error('Error handling CARD_CLICKED', err);
        return res.json(textResponse('⚠️ Error processing action.'));
      }
    }

    // Fallback
    return res.json(textResponse('diagnostic: event received'));
  } catch (err) {
    console.error('Unhandled server error', err);
    return res.json(textResponse('Server error'));
  }
});

app.get('/healthz', (req, res) => res.send('OK'));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server listening on port ${port}`));
