
import React, { useState } from 'react';
import { FileData, RubricCriterion } from '../types';
import { Plus, Trash2, FileUp, Loader2, Sparkles, Link as LinkIcon } from 'lucide-react';
import { processRubricUpload } from '../services/documentProcessingService';

interface Props {
  rubric: RubricCriterion[];
  setRubric: (rubric: RubricCriterion[]) => void;
  rubricContext: string;
  setRubricContext: (context: string) => void;
  rubricFile?: FileData;
  setRubricFile: (file?: FileData) => void;
}

const RubricEditor: React.FC<Props> = ({
  rubric,
  setRubric,
  rubricContext,
  setRubricContext,
  rubricFile,
  setRubricFile,
}) => {
  const [isImporting, setIsImporting] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [url, setUrl] = useState('');

  const addCriterion = () => {
    const newItem: RubricCriterion = {
      id: Math.random().toString(36).substr(2, 9),
      name: '',
      description: '',
      maxPoints: 5,
    };
    setRubric([...rubric, newItem]);
  };

  const removeCriterion = (id: string) => {
    setRubric(rubric.filter((item) => item.id !== id));
  };

  const updateCriterion = (id: string, field: keyof RubricCriterion, value: any) => {
    setRubric(
      rubric.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const processedRubric = await processRubricUpload(file);
      setRubric(processedRubric.criteria);
      setRubricContext(processedRubric.context);
      setRubricFile(processedRubric.fileData);
      if (processedRubric.warnings.length > 0) {
        alert(processedRubric.warnings.join('\n'));
      }
    } catch (error) {
      console.error("Failed to save rubric file:", error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to save rubric file: ${message}`);
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;
    setIsImporting(true);
    setShowUrlInput(false);
    try {
      setRubricFile(undefined);
      setRubricContext(
        [
          'Rubric reference (URL):',
          'This URL will be sent to the model during grading.',
          `URL: ${url.trim()}`,
        ].join('\n')
      );
      setRubric([]);
      setUrl('');
    } catch (error) {
      console.error("Failed to save rubric URL:", error);
      alert("Failed to save rubric URL.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-700">Grading Rubric</h3>
          <p className="text-xs text-slate-500">Add criteria manually, or upload a rubric file to parse and store now (before final grading).</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowUrlInput(!showUrlInput)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-all shadow-sm"
          >
            <LinkIcon size={16} /> Link Google Doc
          </button>

          <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium cursor-pointer transition-all ${
            isImporting ? 'bg-slate-50 text-slate-400 border-slate-200 pointer-events-none' : 'bg-white border-indigo-200 text-indigo-600 hover:bg-indigo-50 shadow-sm'
          }`}>
            {isImporting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileUp size={16} />
            )}
            {isImporting ? 'Saving...' : 'Upload File'}
            <input
              type="file"
              accept=".pdf,.txt,.md,.docx,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={handleFileUpload}
              disabled={isImporting}
            />
          </label>
          
          <button
            onClick={addCriterion}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium shadow-sm"
          >
            <Plus size={16} /> Manual
          </button>
        </div>
      </div>

      {showUrlInput && (
        <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl flex gap-2 animate-in slide-in-from-top-2">
          <input
            type="url"
            placeholder="Paste public Google Doc or Web URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 px-3 py-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
          />
          <button
            onClick={handleUrlImport}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium transition-colors"
          >
            Import Link
          </button>
          <button
            onClick={() => setShowUrlInput(false)}
            className="px-3 py-2 text-slate-400 hover:text-slate-600 text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {rubricContext.trim() && !isImporting && (
        <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700">
          {rubricFile?.name
            ? `Parsed and saved rubric file "${rubricFile.name}". Structured rubric data is now stored for grading.`
            : 'Rubric reference is saved in staged form for grading.'}
        </div>
      )}

      <div className="space-y-3">
        {rubric.length === 0 && !isImporting && (
          <div className="text-center py-10 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
              <Sparkles size={24} className="text-indigo-400" />
            </div>
            <p className="text-slate-500 text-sm font-medium">Your rubric is empty.</p>
            <p className="text-slate-400 text-xs mt-1">Import a document or a Google Doc link to save time!</p>
          </div>
        )}

        {isImporting && (
          <div className="p-12 text-center bg-white border border-slate-200 rounded-xl shadow-sm">
            <Loader2 size={32} className="animate-spin text-indigo-500 mx-auto mb-4" />
            <h4 className="font-semibold text-slate-700">Parsing Rubric...</h4>
            <p className="text-sm text-slate-500 mt-2">We are extracting rubric text and storing structured criteria now to keep final grading prompts small.</p>
          </div>
        )}

        {!isImporting && rubric.map((criterion, index) => (
          <div key={criterion.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm space-y-3 group hover:border-indigo-200 transition-colors">
            <div className="flex gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Criterion Name (e.g., Grammar)"
                  value={criterion.name}
                  onChange={(e) => updateCriterion(criterion.id, 'name', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm font-medium"
                />
              </div>
              <div className="w-24">
                <div className="relative">
                  <input
                    type="number"
                    placeholder="Max"
                    value={criterion.maxPoints}
                    onChange={(e) => updateCriterion(criterion.id, 'maxPoints', parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 pr-8 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  />
                  <span className="absolute right-2 top-2 text-[10px] font-bold text-slate-400">PTS</span>
                </div>
              </div>
              <button
                onClick={() => removeCriterion(criterion.id)}
                className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
            <textarea
              placeholder="Excellence description... What does a full score look like?"
              value={criterion.description}
              onChange={(e) => updateCriterion(criterion.id, 'description', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-20 bg-slate-50/30"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default RubricEditor;
