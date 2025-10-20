// index.js (patched)
// Minimal changes: normalize event shape, attach thread when available, log outgoing payloads.

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

function textResponse(text, threadName) {
  const payload = { text };
  if (threadName) payload.thread = { name: threadName };
  console.log('=> Outgoing payload:', JSON.stringify(payload, null, 2));
  return payload;
}

// Build the dialog JSON that Chat expects (REQUEST_DIALOG response)
function buildDialogResponse(threadName) {
  const dialog = {
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
    // fallback card
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

  // When returning a dialog inline, including thread is safe/harmless.
  if (threadName) dialog.thread = { name: threadName };
  console.log('=> Outgoing dialog payload:', JSON.stringify(dialog, null, 2));
  return dialog;
}

// Handle form action submissions (user clicked Submit in the dialog)
function handleActionSubmit(event, threadName) {
  const inputs = (event && (event.action && event.action.parameters)) || event.formInputs || event.commonEventObject?.formInputs || {};
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

  // Return update message + close dialog
  const payload = {
    actionResponse: { type: "UPDATE_MESSAGE" },
    text: `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`
  };
  if (threadName) payload.thread = { name: threadName };
  console.log('=> Outgoing submit payload:', JSON.stringify(payload, null, 2));
  return payload;
}

app.post('/', (req, res) => {
  const event = req.body || {};
  console.log('==== INCOMING EVENT ====');
  console.log(JSON.stringify(event, null, 2));

  // normalize main fields
  const chat = event.chat || event;
  const message = (chat && chat.message) || event.message || {};
  const threadName = message?.thread?.name || event?.thread?.name || event?.chat?.message?.thread?.name || null;

  // determine text (safe extraction)
  const rawText =
    message?.argumentText ||
    message?.text ||
    event?.argumentText ||
    event?.chat?.message?.text ||
    event?.text ||
    '';

  const text = String(rawText || '').toLowerCase().trim();

  // ACTION handler (dialog submit/cancel)
  if (event.action && event.action.actionMethodName) {
    const methodName = event.action.actionMethodName;
    console.log('Action method:', methodName);
    if (methodName === 'handleSubmit') {
      const resp = handleActionSubmit(event, threadName);
      return res.status(200).json(resp);
    } else if (methodName === 'handleCancel') {
      return res.status(200).json(textResponse('Cancelled.', threadName));
    }
  }

  // If this is an appCommand dialog request (slash command that triggers dialog)
  // Some events include chat.appCommandPayload, others include event.type === 'APP_ACTION' etc.
  if ((event.chat && event.chat.appCommandPayload && event.chat.appCommandPayload.isDialogEvent) ||
      (event.type && event.type.toString().toUpperCase().includes('DIALOG')) ||
      (event.type && event.type.toString().toUpperCase().includes('APP') && event.action && event.action.actionMethodName === 'REQUEST_DIALOG')) {
    console.log('→ Dialog request detected; returning dialog JSON; thread:', threadName);
    return res.status(200).json(buildDialogResponse(threadName));
  }

  // Recognize slash commands or friendly triggers
  if (text === '/pos' || text === '/positive' || text.includes('positive') || text === 'hi') {
    console.log('→ Returning dialog JSON for text:', text);
    return res.status(200).json(buildDialogResponse(threadName));
  }

  // Fallback reply
  return res.status(200).json(textResponse("Got your message – type /positive or 'hi' to open the form.", threadName));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
