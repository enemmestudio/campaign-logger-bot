// index.js
// Google Chat webhook that always replies into the same thread (if available)

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');

const PORT = process.env.PORT || 10000;
const app = express();

app.use(morgan('dev'));
app.use(bodyParser.json());

// Helper that logs and attaches thread if provided
function makeTextPayload(text, threadName) {
  const payload = { text };
  if (threadName) payload.thread = { name: threadName };
  console.log('=> Outgoing payload:', JSON.stringify(payload, null, 2));
  return payload;
}

function buildDialogPayload(threadName) {
  const dialog = {
    actionResponse: {
      type: "DIALOG",
      dialogAction: {
        dialog: {
          title: "Log Positive Response",
          body: { sections: [ { widgets: [
            { textInput: { label: "Prospect Name", name: "prospectName" } },
            { textInput: { label: "Email", name: "email" } },
            { textInput: { label: "Response (copy/paste)", name: "response", multiline: true } }
          ] } ] },
          fixedFooter: {
            primaryButton: { text: "Submit", onClick: { action: { actionMethodName: "handleSubmit" } } },
            secondaryButton: { text: "Cancel", onClick: { action: { actionMethodName: "handleCancel" } } }
          }
        }
      }
    },
    cardsV2: [
      {
        cardId: "dlg-fallback",
        card: {
          header: { title: "Log Positive Response" },
          sections: [ { widgets: [
            { textInput: { label: "Prospect Name", name: "prospectName" } },
            { textInput: { label: "Email", name: "email" } },
            { textInput: { label: "Response (copy/paste)", name: "response", multiline: true } }
          ] } ],
          fixedFooter: {
            primaryButton: { text: "Submit", onClick: { action: { actionMethodName: "handleSubmit" } } },
            secondaryButton: { text: "Cancel", onClick: { action: { actionMethodName: "handleCancel" } } }
          }
        }
      }
    ]
  };

  if (threadName) dialog.thread = { name: threadName };
  console.log('=> Outgoing dialog payload:', JSON.stringify(dialog, null, 2));
  return dialog;
}

function handleActionSubmit(event, threadName) {
  const raw = event?.action?.parameters || event?.formInputs || {};
  const getVal = (k) => {
    const v = raw[k];
    if (v == null) return '';
    if (typeof v === 'object' && 'value' in v) return v.value;
    if (Array.isArray(v) && v.length) {
      if (typeof v[0] === 'object' && 'value' in v[0]) return v[0].value;
      return v[0];
    }
    return v;
  };
  const name = getVal('prospectName') || '';
  const email = getVal('email') || '';
  const responseText = getVal('response') || '';
  const text = `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`;
  const payload = { actionResponse: { type: "UPDATE_MESSAGE" }, text };
  if (threadName) payload.thread = { name: threadName };
  console.log('=> Outgoing submit payload:', JSON.stringify(payload, null, 2));
  return payload;
}

app.post('/', (req, res) => {
  const event = req.body || {};
  console.log('==== INCOMING EVENT ===='); console.log(JSON.stringify(event, null, 2));

  // Normalize extraction of message & thread
  const message = event.chat?.message || event.message || event?.chat?.message || {};
  const threadName = message?.thread?.name || event?.thread?.name || null;
  const rawText = message?.argumentText || message?.text || event?.argumentText || '';
  const text = String(rawText).toLowerCase().trim();

  // Action handlers (dialog submit/cancel)
  if (event?.action?.actionMethodName) {
    const method = event.action.actionMethodName;
    console.log('Action method:', method);
    if (method === 'handleSubmit') return res.status(200).json(handleActionSubmit(event, threadName));
    if (method === 'handleCancel') return res.status(200).json(makeTextPayload('Cancelled.', threadName));
  }

  // Detect dialog requests
  const isDialog = event.chat?.appCommandPayload?.isDialogEvent || (typeof event.type === 'string' && /DIALOG|APP_ACTION/i.test(event.type));
  if (isDialog) return res.status(200).json(buildDialogPayload(threadName));

  // Slash commands or friendly triggers
  if (text === '/pos' || text === '/positive' || text.includes('positive') || text === 'hi') {
    return res.status(200).json(buildDialogPayload(threadName));
  }

  // Default reply - ALWAYS attach thread if available
  return res.status(200).json(makeTextPayload("Got your message – type /positive or 'hi' to open the form.", threadName));
});

// Optional health-check
app.get('/', (req, res) => res.send('Campaign Logger Bot is running.'));

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
