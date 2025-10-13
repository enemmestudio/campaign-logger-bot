// index.js
'use strict';

const express = require('express');
const app = express();

// parse JSON bodies with a reasonable limit
app.use(express.json({ limit: '1mb' }));

/**
 * Build the Dialog response (opens a dialog in the Chat client)
 */
function buildDialogResponse() {
  return {
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
                  { textInput: { label: 'Response (copy/paste)', name: 'response', multiline: true } }
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
      }
    }
  };
}

/**
 * Simple text response helper
 */
function textResponse(text) {
  return { text: text };
}

/**
 * Normalize various incoming Google Chat/Add-on event shapes into a single
 * object with a .type and .message where possible.
 */
function normalizeEvent(raw) {
  const out = Object.assign({}, raw);

  if (!out.type) {
    // Newer Workspace Add-on / Chat v2 shape we saw in logs: raw.chat.messagePayload / raw.chat.message
    if (raw.chat && (raw.chat.messagePayload || raw.chat.message)) {
      out.type = 'MESSAGE';

      // prefer chat.message if present
      const chatMessage = raw.chat.message || (raw.chat.messagePayload && raw.chat.messagePayload.message);
      out.message = chatMessage || {};

      // copy argumentText if present in messagePayload or message
      if (!out.message.argumentText && raw.chat.messagePayload && raw.chat.messagePayload.message) {
        out.message.argumentText = raw.chat.messagePayload.message.argumentText || '';
      }

      // copy commonEventObject for forms
      out.common = raw.commonEventObject || raw.common || {};
      // copy action if present
      if (raw.action) out.action = raw.action;
      // preserve the original payload for deeper inspection if needed
      out.__raw = raw;
    } else if (raw.message) {
      // older simple shape with top-level .message
      out.type = raw.type || 'MESSAGE';
    } else if (raw.authorizationEventObject && raw.configCompleteRedirectUri) {
      // install/config callback shape
      out.type = 'ADDED_TO_SPACE';
    } else if (raw.action) {
      out.type = 'CARD_CLICKED';
    } else {
      // fallback: unknown but keep raw
      out.type = raw.type || 'UNKNOWN';
      out.__raw = raw;
    }
  }

  return out;
}

/**
 * Main webhook handler
 */
app.post('/', async (req, res) => {
  const raw = req.body || {};
  const event = normalizeEvent(raw);

  // debug logs
  try {
    console.log('==== INCOMING EVENT ==== ', new Date().toISOString());
    console.log('HEADERS:', JSON.stringify(req.headers));
    console.log('BODY (truncated):', JSON.stringify(raw).slice(0, 8000));
  } catch (err) {
    console.error('Error logging request', err);
  }

  // convenience: log the normalized event type
  console.log('Normalized event type:', event.type);

  // Utility to send and log response
  function sendJson(obj) {
    try {
      console.log('RESPONSE:', JSON.stringify(obj).slice(0, 8000));
    } catch (e) { /* ignore logging errors */ }
    return res.json(obj);
  }

  try {
    // ADDED_TO_SPACE (installation / configuration complete)
    if (event.type === 'ADDED_TO_SPACE') {
      return sendJson(textResponse("🤖 Campaign Logger Bot added! Type /positive or say 'hi' to open the form."));
    }

    // MESSAGE handling
    if (event.type === 'MESSAGE') {
      // Support multiple shapes: event.message.argumentText, event.message.text, or fallback raw text
      const rawText = (event.message && (event.message.argumentText || event.message.text)) || '';
      const text = String(rawText || '').toLowerCase().trim();

      if (text === '/positive' || text.includes('positive') || text === 'hi' || text === 'hello') {
        return sendJson(buildDialogResponse());
      }

      return sendJson(textResponse("Got your message — type /positive or 'hi' to open the form."));
    }

    // CARD_CLICKED (user clicked a button or submitted a dialog)
    if (event.type === 'CARD_CLICKED' || (event.action && (event.action.actionMethodName || (event.action.actionMethod && event.action.actionMethod.name)))) {
      // normalize action object
      const action = event.action || {};
      const actionMethod = action.actionMethodName || (action.actionMethod && action.actionMethod.name) || '';

      if (actionMethod === 'handleSubmit') {
        let formData = {};

        // action.parameters (array of { key, value })
        if (Array.isArray(action.parameters)) {
          action.parameters.forEach(p => {
            if (p && p.key) formData[p.key] = p.value;
          });
        }

        // Apps Script style: event.common.formInputs
        if (event.common && event.common.formInputs) {
          try {
            Object.keys(event.common.formInputs).forEach(k => {
              const v = event.common.formInputs[k];
              if (v && v.stringInputs && Array.isArray(v.stringInputs.value)) {
                formData[k] = v.stringInputs.value[0] || '';
              }
            });
          } catch (e) {
            console.warn('Error extracting formInputs', e);
          }
        }

        console.log('Form submission data:', JSON.stringify(formData));

        const name = formData.prospectName || formData.prospect_name || '-';
        const email = formData.email || '-';
        const responseText = formData.response || '-';

        const confirmText = `✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`;

        return sendJson(textResponse(confirmText));
      }

      if (actionMethod === 'handleCancel') {
        return sendJson(textResponse('❌ Cancelled logging.'));
      }

      // unknown action
      console.log('CARD_CLICKED unknown action method:', actionMethod);
      return sendJson(textResponse('Action received.'));
    }

    // Fallback for other event types
    return sendJson(textResponse('diagnostic: event received'));
  } catch (err) {
    console.error('Error processing event:', err);
    // return a friendly error to chat client
    return sendJson(textResponse('⚠️ Error processing request on server.'));
  }
});

/**
 * Health check route
 */
app.get('/healthz', (req, res) => res.send('OK'));

/**
 * Start server with graceful shutdown handling
 */
const port = process.env.PORT || 8080;
const server = app.listen(port, () => console.log(`Server listening on port ${port}`));

process.on('SIGTERM', () => {
  console.log('SIGTERM received - shutting down gracefully');
  server.close(() => {
    console.log('Closed out remaining connections');
    process.exit(0);
  });
  // force exit after timeout
  setTimeout(() => {
    console.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  console.log('SIGINT received - shutting down');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  // In production you might attempt a graceful shutdown and restart the process manager
  process.exit(1);
});

process.on('unhandledRejection', (reason, p) => {
  console.error('unhandledRejection at:', p, 'reason:', reason);
});
