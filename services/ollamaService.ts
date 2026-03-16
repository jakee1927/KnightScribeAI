import { GradingConfig, GradeResult, RubricCriterion, Submission, FeedbackStyle } from "../types";

const OLLAMA_API_URL = '/ollama/api/chat';

export const testOllamaConnection = async (): Promise<{ success: boolean; response?: string; error?: string }> => {
  try {
    const response = await fetch(OLLAMA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.5:4b',
        messages: [{ role: 'user', content: 'Say "Hello from Ollama!" in exactly 5 words.' }],
        stream: false,
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data = await response.json();
    return { success: true, response: data.message.content };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
};
const MODEL_NAME = 'qwen3.5:4b';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  format?: 'json';
}

interface OllamaResponse {
  message: {
    role: string;
    content: string;
  };
}

const toFiniteNumber = (value: unknown, fallback: number): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clampScore = (score: number, maxPoints: number): number =>
  Math.min(Math.max(score, 0), maxPoints);

const parseModelJson = (raw: string): any => {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1].trim());
    }

    const jsonObjectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch?.[0]) {
      return JSON.parse(jsonObjectMatch[0]);
    }

    throw new Error('Could not parse JSON from model output.');
  }
};

const normalizeGradeResult = (
  config: GradingConfig,
  parsed: any
): GradeResult => {
  const rawCriterionResults = Array.isArray(parsed?.criterionResults) ? parsed.criterionResults : [];

  // When structured rubric exists, totals are derived strictly from rubric rows.
  if (config.rubric.length > 0) {
    const rawById = new Map<string, any>();
    for (const row of rawCriterionResults) {
      if (row?.criterionId && !rawById.has(String(row.criterionId))) {
        rawById.set(String(row.criterionId), row);
      }
    }

    const normalizedCriterionResults = config.rubric.map((criterion) => {
      const raw = rawById.get(criterion.id) || {};
      const score = clampScore(toFiniteNumber(raw.score, 0), criterion.maxPoints);
      const feedback =
        typeof raw.feedback === 'string' && raw.feedback.trim().length > 0
          ? raw.feedback.trim()
          : 'No criterion-level feedback provided.';

      return {
        criterionId: criterion.id,
        score,
        feedback,
      };
    });

    const totalScore = normalizedCriterionResults.reduce((sum, row) => sum + row.score, 0);
    const maxPossibleScore = config.rubric.reduce((sum, row) => sum + row.maxPoints, 0);
    const overallFeedback =
      typeof parsed?.overallFeedback === 'string' && parsed.overallFeedback.trim().length > 0
        ? parsed.overallFeedback.trim()
        : 'No overall feedback provided.';

    return {
      totalScore,
      maxPossibleScore,
      overallFeedback,
      criterionResults: normalizedCriterionResults,
    };
  }

  // Fallback: no structured rubric rows to anchor to.
  const normalizedCriterionResults = rawCriterionResults.map((row: any) => ({
    criterionId: String(row?.criterionId || 'criterion'),
    score: toFiniteNumber(row?.score, 0),
    feedback: typeof row?.feedback === 'string' ? row.feedback : '',
  }));
  const totalFromRows = normalizedCriterionResults.reduce((sum: number, row: any) => sum + row.score, 0);
  const maxFromModel = toFiniteNumber(parsed?.maxPossibleScore, totalFromRows);

  return {
    totalScore: totalFromRows,
    maxPossibleScore: maxFromModel,
    overallFeedback: typeof parsed?.overallFeedback === 'string' ? parsed.overallFeedback : '',
    criterionResults: normalizedCriterionResults,
  };
};

const callOllama = async (
  messages: OllamaMessage[],
  jsonFormat: boolean = false
): Promise<string> => {
  const payload: OllamaRequest = {
    model: MODEL_NAME,
    messages,
    stream: false,
  };

  if (jsonFormat) {
    payload.format = 'json';
  }

  const response = await fetch(OLLAMA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data: OllamaResponse = await response.json();
  return data.message.content;
};

const getFeedbackInstruction = (style: FeedbackStyle): string => {
  switch (style) {
    case 'glow_and_grow':
      return "Format the 'overallFeedback' into two distinct sections: '🌟 Glows' (what the student did exceptionally well) and '🌱 Grows' (specific areas for future improvement). Use bullet points.";
    case 'rubric_narrative':
      return "Provide 'overallFeedback' as a cohesive, professional narrative paragraph that weaves together the student's performance across all rubric criteria into a single story of their progress.";
    case 'guided_questions':
      return "Do NOT provide direct corrections or answers. Instead, in the 'overallFeedback', provide 3-5 thought-provoking 'Guided Questions' that lead the student to realize where they can improve their work through self-reflection.";
    case 'targeted_rubric':
      return "The 'overallFeedback' should be extremely concise and strictly limited to actionable, direct feedback mapped to specific rubric criteria. No fluff, just direct improvement steps.";
    case 'scoring_with_feedback':
    default:
      return "Provide a balanced summary of the numerical scoring in the 'overallFeedback', explaining the rationale for the final grade.";
  }
};

const RUBRIC_JSON_SCHEMA = `{
  "criteria": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "maxPoints": number
    }
  ]
}`;

const GRADE_RESULT_JSON_SCHEMA = `{
  "totalScore": number,
  "maxPossibleScore": number,
  "overallFeedback": "string",
  "criterionResults": [
    {
      "criterionId": "string",
      "score": number,
      "feedback": "string"
    }
  ]
}`;

export const parseRubricFromMarkdown = async (
  rubricMarkdown: string
): Promise<RubricCriterion[]> => {
  console.log(`[RubricExtraction][criteria.parse.start] Sending extracted OCR/text to ${MODEL_NAME} for rubric JSON parsing (${rubricMarkdown.length} chars).`);
  const messages: OllamaMessage[] = [
    {
      role: 'system',
      content: `You are a rubric extraction assistant. Extract grading rubrics from documents and return them as JSON. 
Output format: ${RUBRIC_JSON_SCHEMA}
If the document doesn't specify points, default to 10.

Critical preservation rules:
- Preserve ALL rubric wording and grading notes in the JSON descriptions.
- Do NOT summarize, shorten, paraphrase, or rewrite for brevity.
- Keep penalties, bonuses, caveats, examples, and conditional rules verbatim when possible.
- Remove only layout noise such as HTML tags and obvious positional/layout artifacts (coordinates, style/layout metadata).`
    },
    {
      role: 'user',
      content: `Extract the grading rubric from this markdown/text. Return the result in the specified JSON format.

Important:
- Keep all meaningful rubric words.
- Only discard position/layout/html artifacts.

Document:
${rubricMarkdown}`
    }
  ];

  const responseText = await callOllama(messages, true);
  const result = parseModelJson(responseText);
  const criteria = result.criteria || [];
  console.log(`[RubricExtraction][criteria.parse.success] Parsed ${criteria.length} rubric criteria from model response.`);
  return criteria;
};

export const parseRubricFromUrl = async (url: string): Promise<RubricCriterion[]> => {
  const messages: OllamaMessage[] = [
    {
      role: 'system',
      content: `You are a rubric extraction assistant. Extract grading rubrics and return them as JSON.
Output format: ${RUBRIC_JSON_SCHEMA}
If the document doesn't specify points, default to 10.`
    },
    {
      role: 'user',
      content: `Extract the grading rubric from the content at this URL: ${url}. Focus on finding criteria, their descriptions, and point values. Return the data as a structured JSON list of criteria.`
    }
  ];

  const responseText = await callOllama(messages, true);
  const result = parseModelJson(responseText);
  return result.criteria;
};

export const gradeSubmission = async (
  config: GradingConfig,
  submission: Submission
): Promise<{ result: GradeResult; feedbackInserted: boolean }> => {
  const styleInstruction = getFeedbackInstruction(config.feedbackStyle);
  const hasStructuredRubric = config.rubric.length > 0;
  const hasRubricContext = !!config.rubricContext?.trim();
  const hasRubricAttachment = !!config.rubricFileData?.data;

  if (!hasStructuredRubric && !hasRubricContext && !hasRubricAttachment) {
    throw new Error('No rubric data provided. Add rubric criteria or upload a rubric document.');
  }

  const structuredRubricBlock = hasStructuredRubric
    ? config.rubric.map(c => `- [ID: ${c.id}] ${c.name} (Max ${c.maxPoints} pts): ${c.description}`).join('\n')
    : 'No manually structured rubric criteria were provided.';

  const uploadedRubricBlock = hasRubricContext
    ? `\nUploaded rubric reference:\n${config.rubricContext}`
    : '';

  const scoringRules = hasStructuredRubric
    ? `
Critical scoring rules:
- Grade every rubric criterion ID listed above.
- "totalScore" MUST equal the exact sum of all criterionResults[i].score.
- "maxPossibleScore" MUST equal the exact sum of rubric max points from the structured criteria.
- Keep every criterion score within [0, criterion max points].`
    : `
Critical scoring rules:
- Derive clear criterionResults from the rubric context/attachment.
- "totalScore" MUST equal the exact sum of all criterionResults[i].score.
- "maxPossibleScore" MUST represent the full score available from your derived grading criteria.`;
  
  const systemPrompt = `You are Qwen, acting as a professional academic grading assistant.

Assignment Context:
- Target Grade Level: ${config.gradeLevel}
- Assignment Prompt/Instructions: ${config.prompt}
- Feedback Style Requirement: ${styleInstruction}

Rubric Context:
- Structured Rubric Criteria:
${structuredRubricBlock}${uploadedRubricBlock}
- Rubric attachment provided in chat: ${hasRubricAttachment ? 'Yes (an uploaded rubric file is attached in a user message below).' : 'No'}

Grading Rules:
- Use the rubric as the authoritative grading source.
- Do not invent rubric standards beyond the provided rubric context/attachment.
- Explain criterion feedback with specific, evidence-based justification tied to student work.
- Apply the selected feedback style exactly.
${scoringRules}

Student Submission Context:
- The student's assignment will be provided as either a URL, plain text, or an attached file in the user messages.
- If an attachment is present, grade the attached student assignment directly.

You MUST respond with valid JSON in this exact format:
${GRADE_RESULT_JSON_SCHEMA}

The output must be strictly valid JSON with no additional text.`;

  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt }
  ];

  if (hasRubricAttachment && config.rubricFileData) {
    messages.push({
      role: 'user',
      content: 'Rubric file attachment for grading context. Use this attachment together with all rubric text/rules in the system prompt.',
      images: [config.rubricFileData.data]
    });
  }

  if (submission.url) {
    messages.push({
      role: 'user',
      content: `The student's assignment is attached as a URL. Grade the student submission at ${submission.url}.`
    });
  } else if (submission.fileData) {
    messages.push({
      role: 'user',
      content: 'The student assignment is attached. Grade this submission using the rubric context and grading rules provided.',
      images: [submission.fileData.data]
    });
  } else {
    messages.push({
      role: 'user',
      content: `The student assignment is provided as text below. Grade it using the rubric context and grading rules provided.\n\nStudent Submission Content:\n\n${submission.content}`
    });
  }

  const responseText = await callOllama(messages, true);
  
  if (!responseText) throw new Error("No response generated from AI.");
  const parsed = parseModelJson(responseText);
  const result = normalizeGradeResult(config, parsed);
  
  return { result, feedbackInserted: false };
};

export const insertFeedbackIntoDoc = async (
  submission: Submission,
  result: GradeResult
): Promise<boolean> => {
  // Ollama-based grading cannot directly insert into Google Docs
  // This would require a separate Google Docs API integration
  console.warn('insertFeedbackIntoDoc is not supported with Ollama. Use Google Docs API separately.');
  return false;
};
