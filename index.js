const express = require('express');
const app = express();
app.use(express.json());

function buildDialogResponse() {
  return {
    "actionResponse": {
      "type": "DIALOG",
      "dialogAction": {
        "dialog": {
          "title": "Log Positive Response",
          "body": {
            "sections": [{
              "widgets": [
                { "textInput": { "label": "Prospect Name", "name": "prospectName" } },
                { "textInput": { "label": "Email", "name": "email" } },
                { "textInput": { "label": "Response (copy/paste)", "name": "response", "multiline": true } }
              ]
            }],
            "fixedFooter": {
              "primaryButton": { "text": "Submit", "onClick": { "action": { "function": "handleSubmit" } } },
              "secondaryButton": { "text": "Cancel", "onClick": { "action": { "function": "handleCancel" } } }
            }
          }
        }
      }
    }
  };
}

app.post('/', (req, res) => {
  const event = req.body || {};
  console.log('Event received:', JSON.stringify(event).slice(0, 2000));

  if (event.type === 'ADDED_TO_SPACE') {
    return res.json({ text: "🤖 Campaign Logger Bot added! Type /positive or say 'hi' to open the form." });
  }

  if (event.type === 'MESSAGE' && event.message && event.message.text) {
    const text = (event.message.text || '').toLowerCase().trim();
    if (text.includes('positive') || text === 'hi' || text === 'hello') {
      return res.json(buildDialogResponse());
    }
    return res.json({ text: "Got your message — type /positive or 'hi' to open the form." });
  }

  res.json({ text: "Event received." });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Listening on port ${port}`));
