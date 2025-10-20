// index.js
// Robust Google Chat webhook: extracts thread from multiple event shapes,
// logs debug, and always attaches thread to outgoing payloads.

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 10000;
const app = express();

app.use(morgan('dev'));
app.use(bodyParser.json());

// Print git hash at startup for verification
try {
  const gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore','pipe','ignore'] })
    .toString().trim();
  console.log('Server starting at git commit:', gitHash);
} catch (e) {
  console.log('Server starting (no git hash available)');
}

function logOutgoing(payload) {
  console.log('=> Outgoing payload:', JSON.stringify(payload, null, 2));
  return payload;
}

function makeTextPayload(text, threadName) {
  const payload = { text };
  if (threadName) payload.thread = { name: threadName };
  return logOutgoing(payload);
}

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
  return logOutgoing(dialog);
}

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
  const payload = { actionResponse: { type: "UPDATE_MESSAGE" }, text };
  if (threadName) payload.thread = { name: threadName };
  return logOutgoing(payload);
}

// Robust thread extraction utility
function extractThreadName(event) {
  // Several places Google Chat may put the message/thread
  const candidates = [
    event?.chat?.message,
    event?.message,
    event?.messagePayload?.message,
    event?.chat?.messagePayload?.message,
    event?.chat?.message?.thread ? event.chat.message : null,
    event?.message?.thread ? event.message : null,
    // fallback: top-level thread (rare)
    event?.thread
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (c?.thread?.name) return c.thread.name;
  }

  // final fallback: maybe space name (will not thread)
  const spaceName = event?.messagePayload?.space?.name || event?.chat?.space?.name || event?.space?.name || null;
  return null; // explicit: we prefer null so we know there is no thread
}

app.post('/', (req, res) => {
  const event = req.body || {};
  console.log('==== INCOMING EVENT ====');
  console.log(JSON.stringify(event, null, 2));

  // Extract thread robustly
  const threadName = extractThreadName(event);
  console.log('DEBUG threadName extracted:', threadName);

  // Extract text (safe)
  const messageObj = event?.chat?.message || event?.message || event?.messagePayload?.message || event?.chat?.messagePayload?.message || {};
  const rawText = messageObj?.argumentText || messageObj?.text || event?.argumentText || '';
  const text = String(rawText || '').toLowerCase().trim();

  // Action handlers
  if (event?.action?.actionMethodName) {
    const method = event.action.actionMethodName;
    console.log('Action method received:', method);
    if (method === 'handleSubmit') return res.status(200).json(handleActionSubmit(event, threadName));
    if (method === 'handleCancel') return res.status(200).json(makeTextPayload('Cancelled.', threadName));
  }

  // Dialog request detection
  const isDialogRequest =
    Boolean(event.chat?.appCommandPayload?.isDialogEvent) ||
    (typeof event.type === 'string' && /DIALOG|APP_ACTION/i.test(event.type));

  if (isDialogRequest) return res.status(200).json(buildDialogPayload(threadName));

  // Slash/trigger detection
  if (text === '/pos' || text === '/positive' || text.includes('positive') || text === 'hi') {
    return res.status(200).json(buildDialogPayload(threadName));
  }

  // Fallback response (attach thread if available)
  return res.status(200).json(makeTextPayload("Got your message – type /positive or 'hi' to open the form.", threadName));
});

app.get('/', (req, res) => res.send('Campaign Logger Bot is running.'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
