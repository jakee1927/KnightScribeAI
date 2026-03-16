import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import * as mammoth from 'mammoth';
import { FileData } from '../types';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

type SourceKind = 'pdf' | 'docx' | 'image' | 'text';
type TraceFlow = 'rubric' | 'submission';

interface ProcessingTrace {
  flow: TraceFlow;
  fileName: string;
  enabled: boolean;
}

export interface ProcessedRubricDocument {
  markdown: string;
  context: string;
  sourceKind: SourceKind;
  pageCount: number;
  fileData?: FileData;
}

export interface ProcessedSubmissionDocument {
  content: string;
  markdown: string;
  sourceKind: SourceKind;
  pageCount: number;
  fileData?: FileData;
}

const createTrace = (flow: TraceFlow, fileName: string, enabled: boolean): ProcessingTrace => ({
  flow,
  fileName,
  enabled,
});

const traceLog = (trace: ProcessingTrace | undefined, step: string, message: string): void => {
  if (!trace?.enabled) return;
  console.log(`[UploadTrace][${trace.flow}][${trace.fileName}][${step}] ${message}`);
};

const isPdfFile = (file: File): boolean =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

const isDocxFile = (file: File): boolean =>
  file.type.includes('wordprocessingml') || file.name.toLowerCase().endsWith('.docx');

const isImageFile = (file: File): boolean =>
  file.type.startsWith('image/');

const isTextFile = (file: File): boolean => {
  const lowerName = file.name.toLowerCase();
  return file.type.startsWith('text/') || lowerName.endsWith('.txt') || lowerName.endsWith('.md');
};

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });

const toFileData = async (file: File): Promise<FileData> => {
  const dataUrl = await readAsDataUrl(file);
  const [, base64 = ''] = dataUrl.split(',');

  if (!base64) {
    throw new Error(`Could not encode ${file.name} as base64.`);
  }

  return {
    data: base64,
    mimeType: file.type || 'application/octet-stream',
  };
};
const extractTextFromPdf = async (file: File, trace?: ProcessingTrace): Promise<{ markdown: string; pageCount: number }> => {
  traceLog(trace, 'pdf.load.start', 'Loading PDF and extracting text from each page.');
  const pdfBytes = await file.arrayBuffer();
  const pdf = await getDocument({ data: pdfBytes }).promise;
  const pageBlocks: string[] = [];
  traceLog(trace, 'pdf.load.success', `PDF loaded with ${pdf.numPages} page(s).`);

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    traceLog(trace, 'pdf.page.extract.start', `Extracting text from page ${pageNumber}/${pdf.numPages}.`);
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const header = pdf.numPages > 1 ? `<!-- Page ${pageNumber} -->\n` : '';
    pageBlocks.push(`${header}${pageText}`.trim());
    traceLog(trace, 'pdf.page.extract.success', `Extracted ${pageText.length} chars from page ${pageNumber}/${pdf.numPages}.`);
  }

  const markdown = pageBlocks.join('\n\n').trim();
  traceLog(trace, 'pdf.extract.success', `PDF text extraction complete (${markdown.length} chars).`);
  return { markdown, pageCount: pdf.numPages };
};

const convertDocxToText = async (file: File, trace?: ProcessingTrace): Promise<string> => {
  traceLog(trace, 'docx.extract.start', 'Extracting raw text from DOCX.');
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = result.value.trim();
  traceLog(trace, 'docx.extract.success', `DOCX text extracted (${text.length} chars).`);
  return text;
};

const formatRubricContext = (markdown: string, sourceKind: SourceKind, pageCount: number): string => {
  const sourceDescription =
    sourceKind === 'pdf'
      ? `PDF (${pageCount} page${pageCount === 1 ? '' : 's'})`
      : sourceKind === 'image'
        ? 'image upload'
        : sourceKind === 'docx'
          ? 'DOCX text extraction'
          : 'text upload';

  return [
    'Rubric reference (uploaded document):',
    `This rubric was extracted from a ${sourceDescription}.`,
    sourceKind === 'docx' || sourceKind === 'text'
      ? 'Formatting: plain extracted text from the source document.'
      : sourceKind === 'pdf'
        ? 'Formatting: PDF text-layer extraction (no OCR preprocessing).'
        : 'Formatting: image source retained for multimodal grading; no pre-extraction performed.',
    '',
    'Rubric content:',
    markdown.trim(),
  ].join('\n');
};

const formatSubmissionContext = (
  fileName: string,
  markdown: string,
  sourceKind: SourceKind,
  pageCount: number
): string => {
  const sourceDescription =
    sourceKind === 'pdf'
      ? `PDF (${pageCount} page${pageCount === 1 ? '' : 's'})`
      : sourceKind === 'image'
        ? 'image file'
        : sourceKind === 'docx'
          ? 'DOCX file'
          : 'text file';

  return [
    `Student submission extracted from file: ${fileName}`,
    `Source type: ${sourceDescription}`,
    sourceKind === 'docx' || sourceKind === 'text'
      ? 'Formatting: extracted plain text.'
      : sourceKind === 'pdf'
        ? 'Formatting: PDF text-layer extraction (no OCR preprocessing).'
        : 'Formatting: image source retained for multimodal grading; no pre-extraction performed.',
    '',
    markdown.trim(),
  ].join('\n');
};

const extractMarkdownFromFile = async (
  file: File,
  trace?: ProcessingTrace
): Promise<{ markdown: string; sourceKind: SourceKind; pageCount: number }> => {
  traceLog(trace, 'extract.start', `Starting extraction for mime type: ${file.type || 'unknown'}.`);
  if (isPdfFile(file)) {
    traceLog(trace, 'path.select', 'Detected PDF input. Route: direct PDF text extraction.');
    const { markdown, pageCount } = await extractTextFromPdf(file, trace);
    traceLog(trace, 'extract.success', `PDF extraction complete (${markdown.length} chars).`);
    return { markdown, sourceKind: 'pdf', pageCount };
  }

  if (isDocxFile(file)) {
    traceLog(trace, 'path.select', 'Detected DOCX input. Route: DOCX -> text (skip OCR).');
    const markdown = await convertDocxToText(file, trace);
    traceLog(trace, 'extract.success', `DOCX extraction complete (${markdown.length} chars).`);
    return { markdown, sourceKind: 'docx', pageCount: 1 };
  }

  if (isImageFile(file)) {
    traceLog(trace, 'path.select', 'Detected image input. Route: preserve image for final multimodal grading (no preprocessing).');
    const markdown = 'Image document uploaded. Text extraction was intentionally skipped so the final grading model can evaluate the attachment directly.';
    traceLog(trace, 'extract.success', `Image preprocessing skipped (${markdown.length} chars of metadata context).`);
    return { markdown, sourceKind: 'image', pageCount: 1 };
  }

  if (isTextFile(file)) {
    traceLog(trace, 'path.select', 'Detected text input. Route: passthrough text extraction.');
    const markdown = (await file.text()).trim();
    traceLog(trace, 'extract.success', `Text extraction complete (${markdown.length} chars).`);
    return { markdown, sourceKind: 'text', pageCount: 1 };
  }

  traceLog(trace, 'extract.error', 'Unsupported file type encountered.');
  throw new Error(`Unsupported file type: ${file.name}`);
};

export const processRubricUpload = async (file: File): Promise<ProcessedRubricDocument> => {
  const trace = createTrace('rubric', file.name, true);
  traceLog(trace, 'workflow.start', 'Rubric extraction workflow started.');
  const { markdown, sourceKind, pageCount } = await extractMarkdownFromFile(file, trace);

  if (!markdown.trim()) {
    traceLog(trace, 'workflow.error', 'Extraction produced empty rubric content.');
    throw new Error(`No rubric content extracted from ${file.name}.`);
  }

  const context = formatRubricContext(markdown, sourceKind, pageCount);
  traceLog(
    trace,
    'workflow.success',
    `Rubric extraction complete. source=${sourceKind}, pages=${pageCount}, markdownChars=${markdown.length}, contextChars=${context.length}.`
  );

  return {
    markdown,
    sourceKind,
    pageCount,
    context,
    fileData: sourceKind === 'image' ? await toFileData(file) : undefined,
  };
};

export const processSubmissionUpload = async (file: File): Promise<ProcessedSubmissionDocument> => {
  const trace = createTrace('submission', file.name, false);
  const { markdown, sourceKind, pageCount } = await extractMarkdownFromFile(file, trace);

  if (!markdown.trim()) {
    throw new Error(`No submission content extracted from ${file.name}.`);
  }

  return {
    markdown,
    sourceKind,
    pageCount,
    content: formatSubmissionContext(file.name, markdown, sourceKind, pageCount),
    fileData: sourceKind === 'image' ? await toFileData(file) : undefined,
  };
};
