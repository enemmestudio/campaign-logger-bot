// index.js
const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(morgan('dev'));
app.use(bodyParser.json());

// Simple GET so visiting the URL shows something
app.get('/', (req, res) => {
  res.send('Campaign Logger Bot is running.');
});

function textResponse(text) {
  return {
    "text": text
  };
}

// Build the dialog JSON that Chat expects (REQUEST_DIALOG response)
function buildDialogResponse() {
  // This is the dialog definition returned inline to open a dialog form.
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
            ]
          },
          fixedFooter: {
            primaryButton: {
              text: "Submit",
              onClick: {
                action: {
                  actionMethodName: "handleSubmit"
                }
              }
            },
            secondaryButton: {
              text: "Cancel",
              onClick: {
                action: {
                  actionMethodName: "handleCancel"
                }
              }
            }
          }
        }
      }
    },

    // Also include a cardsV2 fallback (Chat web client sometimes expects it).
    cardsV2: [
      {
        cardId: "dlg-fallback",
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
    ]
  };
}

// Handle form action submissions (user clicked Submit in the dialog)
function handleActionSubmit(event) {
  // Google Chat sends the form inputs under event.commonEventObject? or event.action? 
  // We'll try common locations used by Chat:
  const inputs = (event && (event.action && event.action.parameters)) || event.formInputs || {};
  // Some payloads send form inputs as { prospectName: { value: '...' } }
  // Normalize them:
  const getVal = (k) => {
    if (!inputs) return '';
    if (inputs[k] && typeof inputs[k] === 'object' && 'value' in inputs[k]) return inputs[k].value;
    if (Array.isArray(inputs[k]) && inputs[k].length) return inputs[k][0].value || inputs[k][0];
    return inputs[k] || '';
  };

  const name = getVal('prospectName');
  const email = getVal('email');
  const responseText = getVal('response');

  console.log('Dialog submit received:', { name, email, responseText });

  // Here you would persist to DB, send email, etc.
  // Return a text message and close dialog (cardsV2 with text is fine).
  return {
    actionResponse: {
      type: "UPDATE_MESSAGE"
    },
    text: `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`
  };
}

// Generic event handler
app.post('/', (req, res) => {
  const event = req.body || {};
  console.log('==== INCOMING EVENT ====');
  console.log(JSON.stringify(event, null, 2));

  // NOTE: In production verify the systemIdToken JWT in event.authorizationEventObject.systemIdToken
  // to ensure requests actually come from Google Chat. (Omitted here for brevity.)

  // Determine type / extract text safely:
  const eventType =
    event.type ||
    (event.commonEventObject && event.commonEventObject.type) ||
    (event.chat && (event.chat.appCommandPayload ? 'REQUEST_DIALOG' : 'MESSAGE')) ||
    'UNKNOWN';

  // If this is a dialog action (user clicked Submit), handle it:
  // Google may send event.action with actionMethodName
  if (event.action && event.action.actionMethodName) {
    const methodName = event.action.actionMethodName;
    console.log('Action method:', methodName);
    if (methodName === 'handleSubmit') {
      const resp = handleActionSubmit(event);
      return res.json(resp);
    } else if (methodName === 'handleCancel') {
      return res.json({ text: 'Cancelled.' });
    }
  }

  // If it is an appCommand dialog request (slash command that triggers dialog):
  if (event.chat && event.chat.appCommandPayload && event.chat.appCommandPayload.isDialogEvent) {
    console.log('→ Dialog request from appCommandPayload');
    return res.json(buildDialogResponse());
  }

  // Extract message text for normal messages:
  const rawText =
    (event.message && (event.message.argumentText || event.message.text)) ||
    (event.argumentText) ||
    (event.chat && event.chat.message && (event.chat.message.text || event.chat.message.argumentText)) ||
    '';

  const text = String(rawText || '').toLowerCase().trim();

  // If slash command /pos or /positive or user typed 'hi' → open dialog
  if (text === '/pos' || text === '/positive' || text.includes('positive') || text === 'hi') {
    console.log('→ Returning dialog JSON for text:', text);
    return res.json(buildDialogResponse());
  }

  // Otherwise fallback text
  return res.json(textResponse("Got your message – type /positive or 'hi' to open the form."));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
