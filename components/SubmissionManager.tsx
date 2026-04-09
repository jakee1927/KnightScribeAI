
import React, { useState } from 'react';
import { Submission } from '../types';
import { FileUp, Trash2, UserPlus, FileText, FileCheck, Link as LinkIcon, Globe, Loader2 } from 'lucide-react';
import { processSubmissionUpload } from '../services/documentProcessingService';

interface Props {
  submissions: Submission[];
  setSubmissions: React.Dispatch<React.SetStateAction<Submission[]>>;
}

const SubmissionManager: React.FC<Props> = ({ submissions, setSubmissions }) => {
  const [newStudentName, setNewStudentName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);

  const addManualSubmission = () => {
    if (!newStudentName.trim() || !newContent.trim()) return;
    const newSub: Submission = {
      id: Math.random().toString(36).substr(2, 9),
      studentName: newStudentName,
      content: newContent,
      origin: 'manual',
      status: 'pending',
    };
    setSubmissions((prev) => [...prev, newSub]);
    setNewStudentName('');
    setNewContent('');
  };

  const addUrlSubmission = () => {
    if (!newStudentName.trim() || !newUrl.trim()) return;
    const newSub: Submission = {
      id: Math.random().toString(36).substr(2, 9),
      studentName: newStudentName,
      content: `[Link Submission: ${newUrl}]`,
      url: newUrl,
      origin: 'url',
      status: 'pending',
    };
    setSubmissions((prev) => [...prev, newSub]);
    setNewStudentName('');
    setNewUrl('');
    setShowUrlInput(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setIsProcessingFiles(true);
    const processErrors: string[] = [];
    const processWarnings: string[] = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files.item(index);
        if (!file) continue;

        try {
          const processed = await processSubmissionUpload(file);
          const newSub: Submission = {
            id: Math.random().toString(36).substr(2, 9),
            studentName: file.name.replace(/\.[^/.]+$/, ""),
            content: processed.content,
            fileData: processed.fileData,
            origin: 'uploaded_file',
            status: 'pending',
          };
          setSubmissions((prev) => [...prev, newSub]);
          if (processed.warnings.length > 0) {
            processWarnings.push(`${file.name}: ${processed.warnings.join(' | ')}`);
          }
        } catch (error) {
          console.error(`Failed to process ${file.name}:`, error);
          const message = error instanceof Error ? error.message : 'Unknown error';
          processErrors.push(`${file.name} (${message})`);
        }
      }

      if (processErrors.length > 0) {
        alert(`Some files could not be processed: ${processErrors.join(', ')}`);
      }
      if (processWarnings.length > 0) {
        alert(`Some files need attention:\n${processWarnings.join('\n')}`);
      }
    } finally {
      setIsProcessingFiles(false);
      e.target.value = '';
    }
  };

  const removeSubmission = (id: string) => {
    setSubmissions((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Manual/URL Add */}
        <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-indigo-600 font-semibold">
              {showUrlInput ? <LinkIcon size={20} /> : <UserPlus size={20} />}
              <span>{showUrlInput ? 'Add Google Doc Link' : 'Manual Entry'}</span>
            </div>
            <button 
              onClick={() => setShowUrlInput(!showUrlInput)}
              className="text-xs font-bold text-slate-400 uppercase hover:text-indigo-600 transition-colors"
            >
              {showUrlInput ? 'Switch to Text' : 'Switch to Link'}
            </button>
          </div>
          
          <input
            type="text"
            placeholder="Student Name"
            value={newStudentName}
            onChange={(e) => setNewStudentName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          />
          
          {showUrlInput ? (
            <input
              type="url"
              placeholder="Paste Google Doc URL..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
            />
          ) : (
            <textarea
              placeholder="Paste student text here..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm h-32"
            />
          )}

          <button
            onClick={showUrlInput ? addUrlSubmission : addManualSubmission}
            disabled={!newStudentName.trim() || (showUrlInput ? !newUrl.trim() : !newContent.trim())}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 font-medium shadow-md shadow-indigo-100"
          >
            Add to Queue
          </button>
        </div>

        {/* File Upload */}
        <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col items-center justify-center text-center space-y-4 border-dashed border-2">
          <div className="p-4 bg-slate-50 rounded-full text-indigo-500">
            <FileUp size={48} />
          </div>
          <div>
            <h4 className="font-semibold text-slate-700">Batch Upload Submissions</h4>
            <p className="text-xs text-slate-500 px-4 mt-1">Upload .txt, .pdf, .docx, or image files. We extract and store grading-ready text now to keep final prompts smaller.</p>
          </div>
          <label className={`bg-slate-800 text-white px-6 py-2 rounded-lg transition-colors font-medium ${isProcessingFiles ? 'opacity-70 pointer-events-none' : 'cursor-pointer hover:bg-slate-900'}`}>
            {isProcessingFiles ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Extracting...
              </span>
            ) : (
              'Choose Files'
            )}
            <input
              type="file"
              multiple
              accept=".txt,.md,.pdf,.docx,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={handleFileUpload}
              disabled={isProcessingFiles}
            />
          </label>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-700">Pending Submissions ({submissions.length})</h3>
          {submissions.length > 0 && (
             <button 
              onClick={() => setSubmissions([])}
              className="text-sm text-rose-500 hover:underline"
             >
               Clear Queue
             </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {submissions.map((sub) => (
            <div key={sub.id} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg shadow-sm group hover:border-indigo-100 transition-colors">
              <div className={`p-2 rounded ${
                sub.origin === 'url' ? 'bg-sky-50 text-sky-500' : 
                sub.origin === 'uploaded_file' ? 'bg-emerald-50 text-emerald-500' : 
                'bg-indigo-50 text-indigo-500'
              }`}>
                {sub.origin === 'url' ? <Globe size={20} /> : sub.origin === 'uploaded_file' ? <FileCheck size={20} /> : <FileText size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{sub.studentName}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                  {sub.origin === 'url' ? 'Link' : sub.origin === 'uploaded_file' ? 'Document' : 'Text'}
                </p>
              </div>
              <button
                onClick={() => removeSubmission(sub.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 text-rose-500 hover:bg-rose-50 rounded transition-all"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {submissions.length === 0 && (
            <div className="col-span-full py-12 text-center bg-white border border-slate-200 rounded-xl">
               <p className="text-slate-400 italic text-sm">Waiting for student submissions...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubmissionManager;
