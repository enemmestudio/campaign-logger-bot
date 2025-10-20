// index.js
// Google Chat webhook that replies into the same thread (if available).
// Node 16+ recommended.

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 10000;
const app = express();

app.use(morgan('dev'));
app.use(bodyParser.json());

// Print git hash at startup (helps verify the running commit)
try {
  const gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
  console.log('Server starting at git commit:', gitHash);
} catch (e) {
  console.log('Server starting (no git hash available)');
}

// Helper: build a text payload and attach thread if available
function makeTextPayload(text, threadName) {
  const payload = { text };
  if (threadName) payload.thread = { name: threadName };
  console.log('=> Outgoing payload:', JSON.stringify(payload, null, 2));
  return payload;
}

// Build dialog payload (REQUEST_DIALOG response) and attach thread if available
function buildDialogPayload(threadName) {
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
    // cardsV2 fallback
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

// Handle dialog submit actions
function handleActionSubmit(event, threadName) {
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

  const name = getVal('prospectName') || '';
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

// Main webhook handler
app.post('/', (req, res) => {
  const event = req.body || {};
  console.log('==== INCOMING EVENT ====');
  console.log(JSON.stringify(event, null, 2));

  // Normalize message and thread extraction
  const message = event.chat?.message || event.message || event?.chat?.message || {};
  const threadName = message?.thread?.name || event?.thread?.name || null;

  // Debug: show the extracted threadName early
  console.log('DEBUG threadName extracted:', threadName);

  const rawText = message?.argumentText || message?.text || event?.argumentText || '';
  const text = String(rawText || '').toLowerCase().trim();

  // Action submissions (dialog submit/cancel)
  if (event?.action?.actionMethodName) {
    const method = event.action.actionMethodName;
    console.log('Action method received:', method);
    if (method === 'handleSubmit') {
      return res.status(200).json(handleActionSubmit(event, threadName));
    }
    if (method === 'handleCancel') {
      return res.status(200).json(makeTextPayload('Cancelled.', threadName));
    }
  }

  // Dialog request detection (slash / app command)
  const isDialogRequest =
    Boolean(event.chat?.appCommandPayload?.isDialogEvent) ||
    (typeof event.type === 'string' && /DIALOG|APP_ACTION/i.test(event.type));

  if (isDialogRequest) {
    return res.status(200).json(buildDialogPayload(threadName));
  }

  // Recognize slash commands or friendly triggers
  if (text === '/pos' || text === '/positive' || text.includes('positive') || text === 'hi') {
    return res.status(200).json(buildDialogPayload(threadName));
  }

  // Default reply — always attach thread if available
  return res.status(200).json(makeTextPayload("Got your message – type /positive or 'hi' to open the form.", threadName));
});

// Healthcheck
app.get('/', (req, res) => res.send('Campaign Logger Bot is running.'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
