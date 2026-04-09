
export interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  maxPoints: number;
}

export interface FileData {
  data?: string; // optional base64 payload (kept empty for staged processing mode)
  mimeType: string;
  name?: string;
  sizeBytes?: number;
}

export type FeedbackStyle = 
  | 'glow_and_grow'
  | 'rubric_narrative'
  | 'scoring_with_feedback'
  | 'guided_questions'
  | 'targeted_rubric';

export interface Submission {
  id: string;
  studentName: string;
  content: string; // text representation
  url?: string; // Optional URL for Google Docs
  fileData?: FileData; // optional source metadata (base64 payload may be omitted in staged mode)
  origin?: 'manual' | 'url' | 'uploaded_file';
  status: 'pending' | 'grading' | 'completed' | 'error';
  result?: GradeResult;
  feedbackInserted?: boolean;
  errorMsg?: string;
}

export interface CriterionResult {
  criterionId: string;
  score: number;
  feedback: string;
}

export interface GradeResult {
  totalScore: number;
  maxPossibleScore: number;
  overallFeedback: string;
  criterionResults: CriterionResult[];
}

export type GradeLevel = 
  | 'Middle School (6-8)'
  | 'High School (9-12)'
  | 'AP/Undergraduate';

export interface GradingConfig {
  prompt: string;
  rubric: RubricCriterion[];
  rubricContext: string;
  rubricFile?: FileData;
  gradeLevel: GradeLevel;
  feedbackStyle: FeedbackStyle;
  autoInsertFeedback: boolean;
}
