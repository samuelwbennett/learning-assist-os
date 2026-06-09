// /lib/openai-client.js
// Shared OpenAI client. Lazily instantiated so cold starts that don't actually
// call OpenAI (e.g. CORS preflights, validation failures) skip the cost.

const OpenAI = require('openai');

let client = null;

function getOpenAI() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

module.exports = { getOpenAI };
