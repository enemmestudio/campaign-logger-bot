// index.js
// Robust Google Chat webhook that extracts space/thread from many event shapes
// and replies into the same thread (if available).
// Uses CommonJS so it runs on Render, Node 18, etc.

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(morgan('dev'));
app.use(bodyParser.json());

// Helper: try to extract space and thread names from all common event shapes.
function extractSpaceAndThread(event = {}) {
  // Several places Chat uses:
  // - event.chat.message.space.name
  // - event.message.space.name
  // - event.chat.messagePayload.space.name
  // - event.messagePayload.space.name
  // - event.addedToSpacePayload.space.name
  // - appCommandPayload.space.name
  // Thread similar: event.chat.message.thread.name etc.
  const tryPaths = [
    ['chat', 'message', 'space', 'name'],
    ['message', 'space', 'name'],
    ['chat', 'messagePayload', 'space', 'name'],
    ['messagePayload', 'space', 'name'],
    ['addedToSpacePayload', 'space', 'name'],
    ['appCommandPayload', 'space', 'name'],
    ['space', 'name'] // sometimes top-level
  ];

  const tryThreadPaths = [
    ['chat', 'message', 'thread', 'name'],
    ['message', 'thread', 'name'],
    ['chat', 'messagePayload', 'message', 'thread', 'name'],
    ['messagePayload', 'message', 'thread', 'name'],
    ['message', 'space', 'thread', 'name'],
    ['thread', 'name']
  ];

  function getByPath(obj, path) {
    return path.reduce((acc, p) => (acc && acc[p] !== undefined ? acc[p] : undefined), obj);
  }

  let spaceName;
  for (const p of tryPaths) {
    const v = getByPath(event, p);
    if (v) { spaceName = v; break; }
  }

  let threadName;
  for (const p of tryThreadPaths) {
    const v = getByPath(event, p);
    if (v) { threadName = v; break; }
  }

  return { spaceName, threadName };
}

// Build a reply payload that attaches to thread if provided
function makeTextPayload(text, threadName) {
  const payload = { text };
  if (threadName) payload.thread = { name: threadName };
  return payload;
}

// Example: return a dialog response (REQUEST_DIALOG flow) when slash or /pos
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
    // fallback cardsV2 so web client behaves consistently
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

  // attach thread if available so the client can open dialog in that context (safe to include)
  if (threadName) dialog.thread = { name: threadName };
  return dialog;
}

// Handle form submission
function handleActionSubmit(event) {
  // Try to find form inputs in event.action.parameters, event.formInputs, or event.commonEventObject
  const inputs = (event && (event.action && event.action.parameters)) || event.formInputs || {};
  const getVal = (k) => {
    if (!inputs) return '';
    // event.formInputs style: { prospectName: { value: '...' } } (or array)
    if (inputs[k] && typeof inputs[k] === 'object' && 'value' in inputs[k]) return inputs[k].value;
    if (Array.isArray(inputs[k]) && inputs[k].length) return inputs[k][0].value || inputs[k][0];
    return inputs[k] || '';
  };

  const name = getVal('prospectName');
  const email = getVal('email');
  const responseText = getVal('response');

  // simple reply message
  return {
    actionResponse: { type: "UPDATE_MESSAGE" },
    text: `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`
  };
}

// Generic webhook handler
app.post('/', async (req, res) => {
  const event = req.body || {};
  console.log('==== INCOMING EVENT ====');
  console.log(JSON.stringify(event, null, 2));

  // Extract space/thread robustly
  const { spaceName, threadName } = extractSpaceAndThread(event);
  console.log('DEBUG extracted:', { spaceName, threadName });

  // If dialog action submission
  if (event.action && event.action.actionMethodName) {
    const methodName = event.action.actionMethodName;
    console.log('Action method:', methodName);
    if (methodName === 'handleSubmit') {
      const resp = handleActionSubmit(event);
      // If we have a thread, try to attach to it (works for some clients)
      if (threadName && !resp.thread) resp.thread = { name: threadName };
      return res.json(resp);
    } else if (methodName === 'handleCancel') {
      return res.json(makeTextPayload('Cancelled.', threadName));
    }
  }

  // If app command asked for a dialog (slash command)
  if (event.chat && event.chat.appCommandPayload && event.chat.appCommandPayload.isDialogEvent) {
    console.log('→ Dialog request from appCommandPayload');
    return res.json(buildDialogResponse(threadName));
  }

  // Get text from possible locations
  const rawText =
    (event.message && (event.message.argumentText || event.message.text)) ||
    (event.argumentText) ||
    (event.chat && event.chat.message && (event.chat.message.text || event.chat.message.argumentText)) ||
    (event.messagePayload && event.messagePayload.message && (event.messagePayload.message.text || event.messagePayload.message.argumentText)) ||
    '';

  const text = String(rawText || '').toLowerCase().trim();

  // If user typed slash or hi -> return dialog
  if (text === '/pos' || text === '/positive' || text.includes('positive') || text === 'hi') {
    console.log('→ Returning dialog JSON for text:', text);
    return res.json(buildDialogResponse(threadName));
  }

  // If we have a spaceName, attach thread when replying via webhook
  if (!spaceName) {
    console.log('No spaceName found in event');
    // fallback text reply (no thread attached)
    return res.json(makeTextPayload("Got your message – type /positive or 'hi' to open the form."));
  }

  // Default reply (attach to thread if found)
  return res.json(makeTextPayload("Got your message – type /positive or 'hi' to open the form.", threadName));
});

// simple GET for health
app.get('/', (req, res) => {
  res.send('✅ Campaign Logger Bot running successfully!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
