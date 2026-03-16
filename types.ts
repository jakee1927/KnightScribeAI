
export interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  maxPoints: number;
}

export interface FileData {
  data: string; // base64
  mimeType: string;
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
  fileData?: FileData; // optional binary data for better AI understanding
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
  rubricFileData?: FileData;
  gradeLevel: GradeLevel;
  feedbackStyle: FeedbackStyle;
  autoInsertFeedback: boolean;
}
