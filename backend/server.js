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
const OPENWEBUI_JWT_TOKEN = process.env.OPENWEBUI_JWT_TOKEN || '';
const DEFAULT_CHAT_MODEL = process.env.OPENWEBUI_MODEL || 'gemma3:12b';
const DEFAULT_OCR_MODEL = process.env.OPENWEBUI_OCR_MODEL || 'deepseek-ocr:latest';

const requireOpenWebUiJwtToken = (res) => {
  if (OPENWEBUI_JWT_TOKEN) return true;
  res.status(500).json({
    error: 'OPENWEBUI_JWT_TOKEN is not configured on the backend.',
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

const extractContentParts = (content) => {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
};

const parseSseResponseBody = (rawBody) => {
  const dataPayloads = rawBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]');

  if (dataPayloads.length === 0) {
    throw new Error('OpenWebUI returned an SSE response without any data payloads.');
  }

  const parsedEvents = dataPayloads.map((payload) => JSON.parse(payload));
  const mergedContent = parsedEvents
    .map((event) => {
      const choice = event?.choices?.[0];
      return extractContentParts(choice?.delta?.content ?? choice?.message?.content);
    })
    .join('');

  const lastEvent = parsedEvents[parsedEvents.length - 1];
  return {
    ...lastEvent,
    choices: [
      {
        ...(lastEvent?.choices?.[0] || {}),
        message: {
          role: 'assistant',
          content: mergedContent,
        },
      },
    ],
  };
};

const parseOpenWebUiResponseBody = (rawBody) => {
  const trimmed = rawBody.trim();

  if (!trimmed) {
    throw new Error('OpenWebUI returned an empty response body.');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed.startsWith('data:')) {
      return parseSseResponseBody(trimmed);
    }

    throw new Error(`Unsupported OpenWebUI response format: ${trimmed.slice(0, 120)}`);
  }
};

const callOpenWebUiChatCompletions = async ({
  model,
  messages,
  jsonFormat = false,
  temperature = 0.1,
  includeRaw = false,
}) => {
  const startedAt = Date.now();
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
      Authorization: `Bearer ${OPENWEBUI_JWT_TOKEN}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenWebUI API error (${response.status}): ${errorText || response.statusText}`);
  }

  const rawBody = await response.text();
  const responseJson = parseOpenWebUiResponseBody(rawBody);
  const elapsedMs = Date.now() - startedAt;
  return {
    content: extractAssistantContent(responseJson),
    raw: includeRaw ? responseJson : undefined,
    elapsedMs,
  };
};

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    openWebUiBaseUrl: OPENWEBUI_BASE_URL,
    hasJwtToken: Boolean(OPENWEBUI_JWT_TOKEN),
  });
});

app.post('/api/chat', async (req, res) => {
  if (!requireOpenWebUiJwtToken(res)) return;

  try {
    const { model, messages, jsonFormat, temperature, includeRaw } = req.body || {};
    const result = await callOpenWebUiChatCompletions({
      model: model || DEFAULT_CHAT_MODEL,
      messages: Array.isArray(messages) ? messages : [],
      jsonFormat: Boolean(jsonFormat),
      temperature: typeof temperature === 'number' ? temperature : 0.1,
      includeRaw: Boolean(includeRaw),
    });

    res.json({
      content: result.content,
      elapsedMs: result.elapsedMs,
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
  if (!requireOpenWebUiJwtToken(res)) return;

  try {
    const { imageBase64, prompt, model, includeRaw } = req.body || {};
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
      includeRaw: Boolean(includeRaw),
    });

    res.json({
      content: result.content,
      elapsedMs: result.elapsedMs,
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
