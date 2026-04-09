
import React, { useState } from 'react';
import { GradingConfig, GradeLevel, Submission, FeedbackStyle } from './types';
import { gradeSubmission, insertFeedbackIntoDoc, testOllamaConnection } from './services/ollamaService';
import RubricEditor from './components/RubricEditor';
import SubmissionManager from './components/SubmissionManager';
import ResultDashboard from './components/ResultDashboard';
import { 
  Settings, Users, GraduationCap, Play, ChevronRight, 
  CheckCircle2, LayoutDashboard, Sparkles, BookOpen, 
  BarChart3, Lightbulb, Target, Zap, Loader2
} from 'lucide-react';

const GRADE_LEVELS: GradeLevel[] = [
  'Middle School (6-8)',
  'High School (9-12)',
  'AP/Undergraduate'
];

interface FeedbackStyleOption {
  id: FeedbackStyle;
  label: string;
  description: string;
  icon: React.ElementType;
}

const FEEDBACK_STYLES: FeedbackStyleOption[] = [
  { 
    id: 'glow_and_grow', 
    label: 'Glow & Grow', 
    description: 'Encouraging strengths and specific areas to grow.', 
    icon: Sparkles 
  },
  { 
    id: 'rubric_narrative', 
    label: 'Narrative Story', 
    description: 'A cohesive paragraph describing performance.', 
    icon: BookOpen 
  },
  { 
    id: 'scoring_with_feedback', 
    label: 'Scoring & Summary', 
    description: 'Balanced scoring with a summative review.', 
    icon: BarChart3 
  },
  { 
    id: 'guided_questions', 
    label: 'Socratic Inquiry', 
    description: 'Guided questions to prompt student thinking.', 
    icon: Lightbulb 
  },
  { 
    id: 'targeted_rubric', 
    label: 'Targeted Feedback', 
    description: 'Direct feedback linked to specific criteria.', 
    icon: Target 
  },
];

const App: React.FC = () => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isGrading, setIsGrading] = useState(false);
  const [isInserting, setIsInserting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ status: 'idle' });

  const handleTestApi = async () => {
    setTestResult({ status: 'loading' });
    const result = await testOllamaConnection();
    if (result.success) {
      setTestResult({ status: 'success', message: result.response });
    } else {
      setTestResult({ status: 'error', message: result.error });
    }
    setTimeout(() => setTestResult({ status: 'idle' }), 5000);
  };
  const [config, setConfig] = useState<GradingConfig>({
    prompt: '',
    gradeLevel: 'High School (9-12)',
    feedbackStyle: 'scoring_with_feedback',
    autoInsertFeedback: false,
    rubricContext: '',
    rubric: [],
  });
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  const handleStartGrading = async () => {
    if (submissions.length === 0) return;
    
    setStep(3);
    setIsGrading(true);

    setSubmissions(prev => prev.map(s => ({ ...s, status: 'grading', result: undefined, feedbackInserted: false, errorMsg: undefined })));

    const gradingPromises = submissions.map(async (sub) => {
      try {
        const { result, feedbackInserted } = await gradeSubmission(config, sub);
        setSubmissions(prev => 
          prev.map(s => s.id === sub.id ? { ...s, status: 'completed', result, feedbackInserted } : s)
        );
      } catch (error: any) {
        console.error(`Error grading ${sub.studentName}:`, error);
        setSubmissions(prev => 
          prev.map(s => s.id === sub.id ? { ...s, status: 'error', errorMsg: error.message || 'An unknown error occurred during grading.' } : s)
        );
      }
    });

    await Promise.all(gradingPromises);
    setIsGrading(false);
  };

  const handleRetryGrading = async (id: string) => {
    const sub = submissions.find(s => s.id === id);
    if (!sub) return;

    setSubmissions(prev => 
      prev.map(s => s.id === id ? { ...s, status: 'grading', result: undefined, feedbackInserted: false, errorMsg: undefined } : s)
    );

    try {
      const { result, feedbackInserted } = await gradeSubmission(config, sub);
      setSubmissions(prev => 
        prev.map(s => s.id === id ? { ...s, status: 'completed', result, feedbackInserted } : s)
      );
    } catch (error: any) {
      console.error(`Error retrying ${sub.studentName}:`, error);
      setSubmissions(prev => 
        prev.map(s => s.id === id ? { ...s, status: 'error', errorMsg: error.message || 'An unknown error occurred during retry.' } : s)
      );
    }
  };

  const handleBatchInsertFeedback = async () => {
    const eligible = submissions.filter(s => s.status === 'completed' && s.url && !s.feedbackInserted);
    if (eligible.length === 0) return;

    setIsInserting(true);
    const promises = eligible.map(async (sub) => {
      try {
        const success = await insertFeedbackIntoDoc(sub, sub.result!);
        if (success) {
          setSubmissions(prev => 
            prev.map(s => s.id === sub.id ? { ...s, feedbackInserted: true } : s)
          );
        }
      } catch (err) {
        console.error(`Failed to insert feedback for ${sub.studentName}:`, err);
      }
    });

    await Promise.all(promises);
    setIsInserting(false);
  };

  const handleSingleInsertFeedback = async (id: string) => {
    const sub = submissions.find(s => s.id === id);
    if (!sub || !sub.url || !sub.result) return;

    setIsInserting(true);
    try {
      const success = await insertFeedbackIntoDoc(sub, sub.result);
      if (success) {
        setSubmissions(prev => 
          prev.map(s => s.id === id ? { ...s, feedbackInserted: true } : s)
        );
      }
    } catch (err) {
      console.error(`Failed to insert feedback for ${sub.studentName}:`, err);
    } finally {
      setIsInserting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <GraduationCap size={24} />
            </div>
            <div>
              <h1 className="font-bold text-xl text-slate-800 tracking-tight">EduGrade <span className="text-indigo-600">AI</span></h1>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Intelligent Assessment Assistant</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestApi}
              disabled={testResult.status === 'loading'}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                testResult.status === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' :
                testResult.status === 'error' ? 'bg-rose-50 border-rose-300 text-rose-700' :
                testResult.status === 'loading' ? 'bg-amber-50 border-amber-300 text-amber-700' :
                'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
              title={testResult.message || 'Test OpenWebUI API connection'}
            >
              {testResult.status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {testResult.status === 'loading' ? 'Testing...' :
               testResult.status === 'success' ? 'Connected!' :
               testResult.status === 'error' ? 'Failed' : 'Test OpenWebUI'}
            </button>
            <nav className="hidden md:flex items-center bg-slate-50 p-1 rounded-lg border border-slate-200">
              <button onClick={() => setStep(1)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${step === 1 ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <Settings size={16} /> Setup
              </button>
              <button onClick={() => setStep(2)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${step === 2 ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <Users size={16} /> Submissions
              </button>
              <button onClick={() => setStep(3)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${step === 3 ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <LayoutDashboard size={16} /> Results
              </button>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center mb-10">
          <div className="flex items-center w-full max-w-lg">
            {[1, 2, 3].map((s, i) => (
              <React.Fragment key={s}>
                <div className="flex flex-col items-center relative">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all border-2 ${
                    step >= s ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-400'
                  }`}>
                    {step > s ? <CheckCircle2 size={20} /> : s}
                  </div>
                  <span className={`absolute -bottom-7 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${
                    step >= s ? 'text-indigo-600' : 'text-slate-400'
                  }`}>
                    {s === 1 ? 'Rubric & Context' : s === 2 ? 'Student Work' : 'AI Grading'}
                  </span>
                </div>
                {i < 2 && <div className={`flex-1 h-0.5 mx-4 transition-all ${step > s ? 'bg-indigo-600' : 'bg-slate-200'}`} />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <main className="min-h-[500px]">
          {step === 1 && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-8">
                <div className="flex items-center gap-2 text-indigo-600 font-bold uppercase text-xs tracking-widest">
                  <Settings size={14} /> Assignment Context
                </div>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-3">Target Grade Level</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {GRADE_LEVELS.map((lvl) => (
                        <button
                          key={lvl}
                          onClick={() => setConfig({ ...config, gradeLevel: lvl })}
                          className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                            config.gradeLevel === lvl ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'
                          }`}
                        >
                          {lvl}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="block text-sm font-semibold text-slate-700">Feedback Strategy</label>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Auto-Insert in Docs</span>
                        <button
                          onClick={() => setConfig({ ...config, autoInsertFeedback: !config.autoInsertFeedback })}
                          className={`w-10 h-5 rounded-full transition-all relative ${config.autoInsertFeedback ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        >
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${config.autoInsertFeedback ? 'translate-x-5' : ''}`} />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
                      {FEEDBACK_STYLES.map((style) => (
                        <button
                          key={style.id}
                          onClick={() => setConfig({ ...config, feedbackStyle: style.id })}
                          className={`flex flex-col items-center p-3 rounded-xl border transition-all text-center group ${
                            config.feedbackStyle === style.id 
                              ? 'bg-indigo-50 border-indigo-400 shadow-sm' 
                              : 'bg-white border-slate-200 hover:border-indigo-200'
                          }`}
                        >
                          <div className={`p-2 rounded-lg mb-2 transition-colors ${
                            config.feedbackStyle === style.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-500'
                          }`}>
                            <style.icon size={20} />
                          </div>
                          <span className={`text-[11px] font-bold uppercase tracking-tight mb-1 ${
                            config.feedbackStyle === style.id ? 'text-indigo-700' : 'text-slate-600'
                          }`}>
                            {style.label}
                          </span>
                          <span className="text-[10px] text-slate-400 leading-tight">
                            {style.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Assignment Prompt / Instructions</label>
                    <textarea
                      placeholder="e.g. Write a 500-word essay analyzing the themes of isolation in Frankenstein..."
                      value={config.prompt}
                      onChange={(e) => setConfig({ ...config, prompt: e.target.value })}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-32 transition-all shadow-inner bg-slate-50/50"
                    />
                  </div>
                </div>
              </section>

              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <RubricEditor
                  rubric={config.rubric}
                  setRubric={(r) => setConfig((prev) => ({ ...prev, rubric: r }))}
                  rubricContext={config.rubricContext}
                  setRubricContext={(context) => setConfig((prev) => ({ ...prev, rubricContext: context }))}
                  rubricFile={config.rubricFile}
                  setRubricFile={(file) => setConfig((prev) => ({ ...prev, rubricFile: file }))}
                />
              </section>

              <div className="flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  disabled={!config.prompt || (config.rubric.length === 0 && !config.rubricContext.trim())}
                  className="flex items-center gap-2 px-8 py-3 bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition-all font-semibold disabled:opacity-50 shadow-lg"
                >
                  Continue to Submissions <ChevronRight size={20} />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in slide-in-from-right duration-500">
              <SubmissionManager submissions={submissions} setSubmissions={setSubmissions} />
              <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <button onClick={() => setStep(1)} className="text-slate-500 font-medium hover:text-slate-700 px-4">Back to Config</button>
                <button
                  onClick={handleStartGrading}
                  disabled={submissions.length === 0 || isGrading}
                  className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-semibold disabled:opacity-50 shadow-lg"
                >
                  <Play size={20} /> Start AI Grading ({submissions.length})
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-in slide-in-from-right duration-500">
              <ResultDashboard 
                submissions={submissions} 
                rubric={config.rubric} 
                onRetry={handleRetryGrading}
                onBatchInsert={handleBatchInsertFeedback}
                onSingleInsert={handleSingleInsertFeedback}
                isInserting={isInserting}
              />
              {!isGrading && (
                <div className="mt-8 flex justify-center">
                  <button onClick={() => setStep(2)} className="px-6 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 font-medium">Return to Queue</button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
      <div className="fixed bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 pointer-events-none opacity-50"></div>
    </div>
  );
};

export default App;
