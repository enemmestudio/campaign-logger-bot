// index.js
'use strict';
const express = require('express');
const app = express();
app.use(express.json({ limit: '1mb' }));

function buildDialogResponseMulti() {
  // canonical actionResponse / DIALOG
  const dialog = {
    actionResponse: {
      type: 'DIALOG',
      dialogAction: {
        dialog: {
          body: {
            sections: [
              {
                header: 'Log Positive Response',
                widgets: [
                  { textInput: { label: 'Prospect Name', name: 'prospectName' } },
                  { textInput: { label: 'Email', name: 'email' } },
                  { textInput: { label: 'Response (copy/paste)', name: 'response', multiline: true } }
                ]
              }
            ]
          },
          fixedFooter: {
            primaryButton: { text: 'Submit', onClick: { action: { actionMethodName: 'handleSubmit' } } },
            secondaryButton: { text: 'Cancel', onClick: { action: { actionMethodName: 'handleCancel' } } }
          }
        }
      }
    }
  };

  // cardsV2 fallback (small card) — some clients prefer this shape
  const cardsV2 = [
    {
      cardId: 'dlg-fallback',
      card: {
        header: { title: 'Log Positive Response' },
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
          primaryButton: { text: 'Submit', onClick: { action: { actionMethodName: 'handleSubmit' } } },
          secondaryButton: { text: 'Cancel', onClick: { action: { actionMethodName: 'handleCancel' } } }
        }
      }
    }
  ];

  // plain text fallback
  const text = 'Opening the positive-response form...';

  // merge: include everything (server will respond with all keys)
  return Object.assign({}, dialog, { cardsV2, text });
}

function textResponse(text) { return { text }; }

function normalizeEvent(raw) {
  const out = Object.assign({}, raw);
  if (!out.type) {
    if (raw.chat && (raw.chat.messagePayload || raw.chat.message)) {
      out.type = 'MESSAGE';
      out.message = raw.chat.message || (raw.chat.messagePayload && raw.chat.messagePayload.message) || {};
      out.common = raw.commonEventObject || raw.common || {};
      if (raw.action) out.action = raw.action;
      out.__raw = raw;
    } else if (raw.message) {
      out.type = raw.type || 'MESSAGE';
    } else if (raw.authorizationEventObject && raw.configCompleteRedirectUri) {
      out.type = 'ADDED_TO_SPACE';
    } else if (raw.action) {
      out.type = 'CARD_CLICKED';
    } else {
      out.type = raw.type || 'UNKNOWN';
      out.__raw = raw;
    }
  }
  return out;
}

app.post('/', (req, res) => {
  const raw = req.body || {};
  const event = normalizeEvent(raw);

  try {
    console.log('==== INCOMING EVENT ==== ', new Date().toISOString());
    console.log('Normalized event type:', event.type);
    console.log('BODY (truncated):', JSON.stringify(raw).slice(0, 8000));
  } catch (e) { console.error('log err', e); }

  const send = obj => {
    try { console.log('RESPONSE SENT (truncated):', JSON.stringify(obj).slice(0, 8000)); }
    catch (e) {}
    return res.json(obj);
  };

  if (event.type === 'ADDED_TO_SPACE') {
    return send(textResponse('🤖 Campaign Logger Bot added! Type /positive or say hi to open the form.'));
  }

  if (event.type === 'MESSAGE') {
    const rawText = (event.message && (event.message.argumentText || event.message.text)) || '';
    const text = String(rawText || '').toLowerCase().trim();
    if (text === '/positive' || text.includes('positive') || text === 'hi' || text === 'hello') {
      return send(buildDialogResponseMulti());
    }
    return send(textResponse("Got your message — type /positive or 'hi' to open the form."));
  }

  if (event.type === 'CARD_CLICKED' || (event.action && (event.action.actionMethodName || (event.action.actionMethod && event.action.actionMethod.name)))) {
    try {
      const action = event.action || {};
      const actionMethod = action.actionMethodName || (action.actionMethod && action.actionMethod.name) || '';
      if (actionMethod === 'handleSubmit') {
        let formData = {};
        if (Array.isArray(action.parameters)) {
          action.parameters.forEach(p => { if (p && p.key) formData[p.key] = p.value; });
        }
        if (event.common && event.common.formInputs) {
          try {
            Object.keys(event.common.formInputs).forEach(k => {
              const v = event.common.formInputs[k];
              if (v && v.stringInputs && Array.isArray(v.stringInputs.value)) {
                formData[k] = v.stringInputs.value[0] || '';
              }
            });
          } catch (e) { /* ignore */ }
        }
        console.log('Form submission data:', JSON.stringify(formData));
        const name = formData.prospectName || '-';
        const email = formData.email || '-';
        const responseText = formData.response || '-';
        return send(textResponse(`✅ Positive Response Logged:\n• Name: ${name}\n• Email: ${email}\n• Response: ${responseText}`));
      }
      if (actionMethod === 'handleCancel') {
        return send(textResponse('❌ Cancelled logging.'));
      }
      console.log('Unknown CARD_CLICKED action:', actionMethod);
      return send(textResponse('Action received.'));
    } catch (err) {
      console.error('Error handling CARD_CLICKED', err);
      return send(textResponse('⚠️ Error processing action.'));
    }
  }

  return send(textResponse('diagnostic: event received'));
});

app.get('/healthz', (req, res) => res.send('OK'));

const port = process.env.PORT || 8080;
const server = app.listen(port, () => console.log(`Server listening on port ${port}`));
process.on('SIGTERM', () => { console.log('SIGTERM'); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('uncaughtException', e => { console.error('uncaught', e); process.exit(1); });
process.on('unhandledRejection', (r) => { console.error('unhandledRejection', r); });
