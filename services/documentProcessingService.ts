import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import * as mammoth from 'mammoth';

const OPENWEBUI_OCR_API_URL = '/backend/api/ocr';
const OCR_MODEL = 'deepseek-ocr:latest';
const OCR_PROMPT = '<image>\n<|grounding|>Convert the document to markdown.';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface OllamaOcrResponse {
  content?: string;
  error?: string;
}

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
}

export interface ProcessedSubmissionDocument {
  content: string;
  markdown: string;
  sourceKind: SourceKind;
  pageCount: number;
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

const fileToBase64 = async (file: File): Promise<string> => {
  const dataUrl = await readAsDataUrl(file);
  const [, base64 = ''] = dataUrl.split(',');
  if (!base64) throw new Error(`Could not encode ${file.name} as base64.`);
  return base64;
};

const runOcrForImage = async (
  imageBase64: string,
  trace?: ProcessingTrace,
  pageNumber?: number,
  totalPages?: number
): Promise<string> => {
  const pageLabel = pageNumber && totalPages ? `page ${pageNumber}/${totalPages}` : 'single image';
  traceLog(trace, 'ocr.request.start', `Sending API request to DeepSeek OCR for ${pageLabel}.`);

  const response = await fetch(OPENWEBUI_OCR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OCR_MODEL,
      prompt: OCR_PROMPT,
      imageBase64,
    }),
  });

  if (!response.ok) {
    traceLog(trace, 'ocr.request.error', `DeepSeek OCR request failed with status ${response.status}.`);
    throw new Error(`OCR request failed: ${response.status} ${response.statusText}`);
  }
  traceLog(trace, 'ocr.request.success', `DeepSeek OCR responded successfully for ${pageLabel}.`);

  const data = (await response.json()) as OllamaOcrResponse;
  const extractedText = (data.content || '').trim();
  traceLog(trace, 'ocr.extract.success', `OCR text extracted for ${pageLabel} (${extractedText.length} chars).`);
  return extractedText;
};

const flattenImagePagesToMarkdown = async (
  pages: string[],
  trace?: ProcessingTrace
): Promise<string> => {
  const pageMarkdown: string[] = [];
  traceLog(trace, 'ocr.batch.start', `Starting OCR over ${pages.length} page image(s).`);

  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1;
    traceLog(trace, 'ocr.page.start', `Starting OCR for page ${pageNumber}/${pages.length}.`);
    const pageResult = await runOcrForImage(pages[index], trace, pageNumber, pages.length);
    const header = pages.length > 1 ? `<!-- Page ${index + 1} -->\n` : '';
    pageMarkdown.push(`${header}${pageResult}`.trim());
    traceLog(trace, 'ocr.page.success', `Completed OCR for page ${pageNumber}/${pages.length}.`);
  }

  traceLog(trace, 'ocr.batch.success', 'Completed OCR for all image pages.');
  return pageMarkdown.join('\n\n');
};

const convertPdfToImagePages = async (file: File, trace?: ProcessingTrace): Promise<string[]> => {
  traceLog(trace, 'pdf.load.start', 'Loading PDF and preparing page-to-image conversion.');
  const pdfBytes = await file.arrayBuffer();
  const pdf = await getDocument({ data: pdfBytes }).promise;
  const imagePages: string[] = [];
  traceLog(trace, 'pdf.load.success', `PDF loaded with ${pdf.numPages} page(s).`);

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    traceLog(trace, 'pdf.page.render.start', `Rendering page ${pageNumber}/${pdf.numPages} to image.`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const canvasContext = canvas.getContext('2d');

    if (!canvasContext) {
      throw new Error('Unable to initialize canvas rendering context for PDF conversion.');
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({ canvas, canvasContext, viewport }).promise;

    const dataUrl = canvas.toDataURL('image/png');
    const [, base64 = ''] = dataUrl.split(',');
    if (!base64) {
      throw new Error(`Failed to convert PDF page ${pageNumber} into an image.`);
    }
    imagePages.push(base64);
    traceLog(trace, 'pdf.page.render.success', `Converted page ${pageNumber}/${pdf.numPages} to image.`);
  }

  traceLog(trace, 'pdf.convert.success', `PDF converted to ${imagePages.length} image page(s).`);
  return imagePages;
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
      : 'Formatting: OCR markdown generated by deepseek-ocr:latest, which may include HTML-like blocks.',
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
      : 'Formatting: OCR markdown generated by deepseek-ocr:latest.',
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
    traceLog(trace, 'path.select', 'Detected PDF input. Route: PDF -> images -> DeepSeek OCR.');
    const imagePages = await convertPdfToImagePages(file, trace);
    const markdown = await flattenImagePagesToMarkdown(imagePages, trace);
    traceLog(trace, 'extract.success', `PDF extraction complete (${markdown.length} chars).`);
    return { markdown, sourceKind: 'pdf', pageCount: imagePages.length };
  }

  if (isDocxFile(file)) {
    traceLog(trace, 'path.select', 'Detected DOCX input. Route: DOCX -> text (skip OCR).');
    const markdown = await convertDocxToText(file, trace);
    traceLog(trace, 'extract.success', `DOCX extraction complete (${markdown.length} chars).`);
    return { markdown, sourceKind: 'docx', pageCount: 1 };
  }

  if (isImageFile(file)) {
    traceLog(trace, 'path.select', 'Detected image input. Route: image -> DeepSeek OCR.');
    const imageBase64 = await fileToBase64(file);
    traceLog(trace, 'image.encode.success', 'Image encoded to base64 for OCR request.');
    const markdown = await flattenImagePagesToMarkdown([imageBase64], trace);
    traceLog(trace, 'extract.success', `Image OCR extraction complete (${markdown.length} chars).`);
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
  };
};
