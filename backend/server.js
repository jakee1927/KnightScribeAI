import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const fileContents = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of fileContents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

const app = express();
app.use(express.json({ limit: '50mb' }));

const BACKEND_PORT = Number(process.env.BACKEND_PORT || 4000);
const OPENWEBUI_BASE_URL = (process.env.OPENWEBUI_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const OPENWEBUI_API_KEY = process.env.OPENWEBUI_API_KEY || '';
const DEFAULT_CHAT_MODEL = process.env.OPENWEBUI_MODEL || 'gemma3:12b';
const DEFAULT_OCR_MODEL = process.env.OPENWEBUI_OCR_MODEL || 'deepseek-ocr:latest';

const requireOpenWebUiApiKey = (res) => {
  if (OPENWEBUI_API_KEY) return true;
  res.status(500).json({
    error: 'OPENWEBUI_API_KEY is not configured on the backend.',
  });
  return false;
};

const normalizeMessages = (messages = []) =>
  messages.map((message) => {
    const role = message?.role || 'user';
    const content = message?.content ?? '';
    const images = Array.isArray(message?.images) ? message.images : [];

    if (images.length === 0) {
      return { role, content };
    }

    const multimodalContent = [
      { type: 'text', text: String(content || '') },
      ...images.map((base64Image) => ({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64Image}` },
      })),
    ];

    return {
      role,
      content: multimodalContent,
    };
  });

const extractAssistantContent = (responseJson) => {
  const content = responseJson?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
  }

  return '';
};

const callOpenWebUiChatCompletions = async ({
  model,
  messages,
  jsonFormat = false,
  temperature = 0.1,
}) => {
  const payload = {
    model: model || DEFAULT_CHAT_MODEL,
    messages: normalizeMessages(messages),
    temperature,
    stream: false,
  };

  if (jsonFormat) {
    payload.response_format = { type: 'json_object' };
  }

  const response = await fetch(`${OPENWEBUI_BASE_URL}/api/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENWEBUI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenWebUI API error (${response.status}): ${errorText || response.statusText}`);
  }

  const responseJson = await response.json();
  return {
    content: extractAssistantContent(responseJson),
    raw: responseJson,
  };
};

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    openWebUiBaseUrl: OPENWEBUI_BASE_URL,
    hasApiKey: Boolean(OPENWEBUI_API_KEY),
  });
});

app.post('/api/chat', async (req, res) => {
  if (!requireOpenWebUiApiKey(res)) return;

  try {
    const { model, messages, jsonFormat, temperature } = req.body || {};
    const result = await callOpenWebUiChatCompletions({
      model: model || DEFAULT_CHAT_MODEL,
      messages: Array.isArray(messages) ? messages : [],
      jsonFormat: Boolean(jsonFormat),
      temperature: typeof temperature === 'number' ? temperature : 0.1,
    });

    res.json({
      content: result.content,
      raw: result.raw,
    });
  } catch (error) {
    console.error('[backend/api/chat] Request failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown backend error',
    });
  }
});

app.post('/api/ocr', async (req, res) => {
  if (!requireOpenWebUiApiKey(res)) return;

  try {
    const { imageBase64, prompt, model } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: 'imageBase64 is required.' });
      return;
    }

    const ocrPrompt =
      typeof prompt === 'string' && prompt.trim().length > 0
        ? prompt
        : '<image>\n<|grounding|>Convert the document to markdown.';

    const result = await callOpenWebUiChatCompletions({
      model: typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_OCR_MODEL,
      messages: [
        {
          role: 'user',
          content: ocrPrompt,
          images: [imageBase64],
        },
      ],
      jsonFormat: false,
      temperature: 0,
    });

    res.json({
      content: result.content,
      raw: result.raw,
    });
  } catch (error) {
    console.error('[backend/api/ocr] OCR request failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown OCR backend error',
    });
  }
});

app.listen(BACKEND_PORT, () => {
  console.log(`[backend] OpenWebUI proxy listening on http://localhost:${BACKEND_PORT}`);
  console.log(`[backend] OpenWebUI base URL: ${OPENWEBUI_BASE_URL}`);
});
