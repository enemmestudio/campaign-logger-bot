// index.js
// Simple Google Chat bot webhook that replies in the same thread
// Node 16+ recommended

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');

const PORT = process.env.PORT || 10000;
const app = express();

app.use(morgan('dev'));
app.use(bodyParser.json());

// --- Helpers that attach thread if available ---
function makeTextPayload(text, threadName) {
  const payload = { text };
  if (threadName) payload.thread = { name: threadName };
  console.log('=> Outgoing payload:', JSON.stringify(payload, null, 2));
  return payload;
}

function buildDialogPayload(threadName) {
  const payload = {
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

  if (threadName) payload.thread = { name: threadName };
  console.log('=> Outgoing dialog payload:', JSON.stringify(payload, null, 2));
  return payload;
}

function handleActionSubmit(event, threadName) {
  // Support multiple event shapes for form inputs
  const rawInputs = event?.action?.parameters || event?.formInputs || event?.commonEventObject?.formInputs || {};
  const getVal = (k) => {
    const v = rawInputs[k];
    if (v == null) return '';
    if (typeof v === 'object' && 'value' in v) return v.value;
    if (Array.isArray(v) && v.length) {
      if (typeof v[0] === 'object' && 'value' in v[0]) return v[0].value;
      return v[0];
    }
    return v;
  };

  const name = getVal('prospectName') || getVal('prospect') || '';
  const email = getVal('email') || '';
  const responseText = getVal('response') || '';

  const text = `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`;
  const payload = {
    actionResponse: { type: "UPDATE_MESSAGE" },
    text
  };
  if (threadName) payload.thread = { name: threadName };
  console.log('=> Outgoing submit payload:', JSON.stringify(payload, null, 2));
  return payload;
}

// --- Main webhook handler ---
app.post('/', (req, res) => {
  const event = req.body || {};
  console.log('==== INCOMING EVENT ====');
  console.log(JSON.stringify(event, null, 2));

  // normalize the message and thread
  const message = event.chat?.message || event.message || event?.chat?.message || {};
  const threadName = message?.thread?.name || event?.thread?.name || null;

  const rawText = message?.argumentText || message?.text || event?.argumentText || '';
  const text = String(rawText || '').toLowerCase().trim();

  // Action submissions (dialog submit / cancel)
  if (event?.action?.actionMethodName) {
    const method = event.action.actionMethodName;
    console.log('Action method:', method);
    if (method === 'handleSubmit') {
      const resp = handleActionSubmit(event, threadName);
      return res.status(200).json(resp);
    }
    if (method === 'handleCancel') {
      return res.status(200).json(makeTextPayload('Cancelled.', threadName));
    }
  }

  // If this is a dialog request from a slash command or app action
  const isDialogRequest = event.chat?.appCommandPayload?.isDialogEvent ||
                          (typeof event.type === 'string' && /DIALOG|APP_ACTION/i.test(event.type));

  if (isDialogRequest) {
    return res.status(200).json(buildDialogPayload(threadName));
  }

  // Recognize slash commands or friendly triggers
  if (text === '/pos' || text === '/positive' || text.includes('positive') || text === 'hi') {
    return res.status(200).json(buildDialogPayload(threadName));
  }

  // fallback response — include thread so reply appears in DM/thread
  return res.status(200).json(makeTextPayload("Got your message – type /positive or 'hi' to open the form.", threadName));
});

// Healthcheck / root
app.get('/', (req, res) => res.send('Campaign Logger Bot is running.'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
