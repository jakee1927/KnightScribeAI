
import { GoogleGenAI, Type, FunctionDeclaration, ThinkingLevel } from "@google/genai";
import { GradingConfig, GradeResult, RubricCriterion, Submission, FeedbackStyle } from "../types";

// Always use process.env.API_KEY directly when initializing the client.
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const RUBRIC_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    criteria: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          maxPoints: { type: Type.NUMBER },
        },
        required: ["id", "name", "description", "maxPoints"],
      }
    }
  },
  required: ["criteria"]
};

const appendFeedbackToDocTool: FunctionDeclaration = {
  name: 'appendFeedbackToDoc',
  parameters: {
    type: Type.OBJECT,
    description: 'Appends structured grading feedback and scores to the end of a Google Doc.',
    properties: {
      docUrl: {
        type: Type.STRING,
        description: 'The URL of the Google Doc to append feedback to.',
      },
      feedbackContent: {
        type: Type.STRING,
        description: 'The formatted feedback string to insert.',
      },
      scoreSummary: {
        type: Type.STRING,
        description: 'A summary of the points earned vs total points.',
      }
    },
    required: ['docUrl', 'feedbackContent', 'scoreSummary'],
  },
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

export const parseRubricFromFile = async (
  base64Data: string,
  mimeType: string
): Promise<RubricCriterion[]> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      { inlineData: { data: base64Data, mimeType: mimeType } },
      "Extract the grading rubric from this document. Return the result in the specified JSON format. If the document doesn't specify points, default to 10.",
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RUBRIC_SCHEMA,
    },
  });

  if (!response.text) throw new Error("Could not extract rubric from file.");
  const result = JSON.parse(response.text.trim());
  return result.criteria;
};

export const parseRubricFromUrl = async (url: string): Promise<RubricCriterion[]> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Extract the grading rubric from the content at this URL: ${url}. Focus on finding criteria, their descriptions, and point values. Return the data as a structured JSON list of criteria.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: RUBRIC_SCHEMA,
    },
  });

  if (!response.text) throw new Error("Could not extract rubric from URL.");
  const result = JSON.parse(response.text.trim());
  return result.criteria;
};

export const gradeSubmission = async (
  config: GradingConfig,
  submission: Submission
): Promise<{ result: GradeResult; feedbackInserted: boolean }> => {
  const ai = getAI();

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      totalScore: { type: Type.NUMBER },
      maxPossibleScore: { type: Type.NUMBER },
      overallFeedback: { type: Type.STRING },
      criterionResults: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            criterionId: { type: Type.STRING },
            score: { type: Type.NUMBER },
            feedback: { type: Type.STRING },
          },
          required: ["criterionId", "score", "feedback"],
        },
      },
    },
    required: ["totalScore", "maxPossibleScore", "overallFeedback", "criterionResults"],
  };

  const styleInstruction = getFeedbackInstruction(config.feedbackStyle);
  const systemInstruction = `You are a professional academic grader. 
Target Grade Level: ${config.gradeLevel}
Assignment Prompt: ${config.prompt}
Feedback Style: ${styleInstruction}

Grading Standards:
${config.rubric.map(c => `- [ID: ${c.id}] ${c.name} (Max ${c.maxPoints} pts): ${c.description}`).join('\n')}

The output must be strictly valid JSON.`;

  const contents: any[] = [];
  const tools: any[] = [];
  
  if (config.autoInsertFeedback && submission.url) {
    tools.push({ functionDeclarations: [appendFeedbackToDocTool] });
  }

  if (submission.url) {
    contents.push(`Grade the student submission at ${submission.url}. ${config.autoInsertFeedback ? 'Use appendFeedbackToDoc to insert results if scoring is successful.' : ''}`);
  } else if (submission.fileData?.data) {
    contents.push(
      { inlineData: { data: submission.fileData.data, mimeType: submission.fileData.mimeType } },
      `Grade this student submission.`
    );
  } else {
    contents.push(`Student Submission Content:\n\n${submission.content}`);
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema,
      tools: tools.length > 0 ? tools : undefined,
      temperature: 0.1,
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
    },
  });

  if (!response.text) throw new Error("No response generated from AI.");
  const result = JSON.parse(response.text.trim()) as GradeResult;
  const toolCall = response.functionCalls?.find(fc => fc.name === 'appendFeedbackToDoc');
  
  return { result, feedbackInserted: !!toolCall };
};

export const insertFeedbackIntoDoc = async (
  submission: Submission,
  result: GradeResult
): Promise<boolean> => {
  if (!submission.url) return false;
  
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Please insert the following feedback into the document at ${submission.url} using the appendFeedbackToDoc tool.
    
    Score Summary: ${result.totalScore} / ${result.maxPossibleScore}
    Feedback: ${result.overallFeedback}`,
    config: {
      tools: [{ functionDeclarations: [appendFeedbackToDocTool] }],
    },
  });

  const toolCall = response.functionCalls?.find(fc => fc.name === 'appendFeedbackToDoc');
  return !!toolCall;
};
