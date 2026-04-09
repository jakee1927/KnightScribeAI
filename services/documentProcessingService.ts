import { FileData, RubricCriterion } from '../types';
import { parseRubricFromMarkdown } from './ollamaService';

type SourceKind = 'pdf' | 'docx' | 'image' | 'text' | 'binary';

export interface ProcessedRubricDocument {
  context: string;
  sourceKind: SourceKind;
  pageCount: number;
  fileData: FileData;
  criteria: RubricCriterion[];
  warnings: string[];
}

export interface ProcessedSubmissionDocument {
  content: string;
  sourceKind: SourceKind;
  pageCount: number;
  fileData: FileData;
  warnings: string[];
}

interface ExtractedTextResult {
  text: string;
  pageCount: number;
  warnings: string[];
}

interface OpenWebUIBackendResponse {
  content: string;
  elapsedMs?: number;
  error?: string;
}

const MAX_RUBRIC_PARSE_CHARS = 18000;
const MAX_RUBRIC_CONTEXT_CHARS = 5000;
const MAX_SUBMISSION_CHARS = 14000;
const MAX_OCR_PAGES = 8;
const OPENWEBUI_BACKEND_CHAT_URL = '/backend/api/chat';

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

const detectSourceKind = (file: File): SourceKind => {
  if (isPdfFile(file)) return 'pdf';
  if (isDocxFile(file)) return 'docx';
  if (isImageFile(file)) return 'image';
  if (isTextFile(file)) return 'text';
  return 'binary';
};

const formatSize = (sizeBytes: number): string => {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};

const normalizeWhitespace = (text: string): string =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const capText = (text: string, maxChars: number): { value: string; wasTruncated: boolean } => {
  if (text.length <= maxChars) return { value: text, wasTruncated: false };
  return {
    value: `${text.slice(0, maxChars)}\n\n[Truncated to fit prompt budget.]`,
    wasTruncated: true,
  };
};

const createFileData = (file: File): FileData => ({
  mimeType: file.type || 'application/octet-stream',
  name: file.name,
  sizeBytes: file.size,
});

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });

const imageFileToPngBase64 = async (file: File): Promise<string> => {
  const sourceDataUrl = await readAsDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not decode image ${file.name}`));
    img.src = sourceDataUrl;
  });

  const canvas = document.createElement('canvas');
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    throw new Error(`Image has invalid dimensions: ${file.name}`);
  }

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not initialize canvas for image OCR.');
  }
  context.drawImage(image, 0, 0);

  const pngDataUrl = canvas.toDataURL('image/png');
  const [, base64 = ''] = pngDataUrl.split(',');
  if (!base64) throw new Error(`Could not convert ${file.name} to PNG base64.`);
  return base64;
};

const callVisionOcr = async (imageBase64: string, prompt: string): Promise<string> => {
  const response = await fetch(OPENWEBUI_BACKEND_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
      jsonFormat: false,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Vision OCR request failed (${response.status}): ${errorBody || response.statusText}`);
  }

  const data: OpenWebUIBackendResponse = await response.json();
  return normalizeWhitespace(data.content || '');
};

const runVisionOcrOnPages = async (
  pageImages: string[],
  sourceLabel: 'pdf' | 'image'
): Promise<{ text: string; warnings: string[] }> => {
  const warnings: string[] = [];
  if (pageImages.length === 0) {
    return { text: '', warnings };
  }

  const selectedPages =
    pageImages.length > MAX_OCR_PAGES ? pageImages.slice(0, MAX_OCR_PAGES) : pageImages;

  if (pageImages.length > MAX_OCR_PAGES) {
    warnings.push(`OCR limited to first ${MAX_OCR_PAGES} pages to control upload-time cost.`);
  }

  const pageChunks: string[] = [];
  for (let index = 0; index < selectedPages.length; index += 1) {
    const pageNumber = index + 1;
    try {
      const pageText = await callVisionOcr(
        selectedPages[index],
        [
          `Extract all readable text from this ${sourceLabel} page.`,
          'Return plain text only.',
          'Do not summarize or interpret.',
          'Preserve headings, bullets, and line breaks when possible.',
        ].join(' ')
      );
      if (pageText) {
        pageChunks.push(`[Page ${pageNumber}] ${pageText}`);
      } else {
        warnings.push(`Vision OCR returned no text for page ${pageNumber}.`);
      }
    } catch (error: any) {
      warnings.push(`Vision OCR failed on page ${pageNumber}: ${error?.message || 'Unknown OCR error'}`);
    }
  }

  return {
    text: pageChunks.join('\n\n'),
    warnings,
  };
};

let pdfWorkerConfigured = false;
const getPdfJs = async (): Promise<any> => {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any;
  if (!pdfWorkerConfigured && pdfjs?.GlobalWorkerOptions) {
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
        import.meta.url
      ).toString();
      pdfWorkerConfigured = true;
    } catch {
      // If worker URL setup fails, pdf.js can still run using a fake worker path in many environments.
    }
  }
  return pdfjs;
};

const renderPdfPagesToImages = async (doc: any): Promise<string[]> => {
  const imagePages: string[] = [];
  const totalPages = Math.min(doc.numPages || 1, MAX_OCR_PAGES);

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not initialize canvas for PDF rendering.');
    }
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/png');
    const [, base64 = ''] = dataUrl.split(',');
    if (base64) {
      imagePages.push(base64);
    }
  }

  return imagePages;
};

const extractPdfText = async (file: File): Promise<ExtractedTextResult> => {
  const warnings: string[] = [];
  const pdfjs = await getPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const pageCount = doc.numPages || 1;

  try {
    const pageChunks: string[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = normalizeWhitespace(
          textContent.items.map((item: any) => (typeof item?.str === 'string' ? item.str : '')).join(' ')
        );
        if (pageText) {
          pageChunks.push(`[Page ${pageNumber}] ${pageText}`);
        }
      }
    } catch (error: any) {
      warnings.push(`PDF text-layer extraction failed: ${error?.message || 'Unknown parse error'}`);
    }

    if (pageChunks.length > 0) {
      return {
        text: pageChunks.join('\n\n'),
        pageCount,
        warnings,
      };
    }

    warnings.push('No embedded PDF text found. Falling back to model OCR/image analysis.');

    const pageImages = await renderPdfPagesToImages(doc);
    const ocr = await runVisionOcrOnPages(pageImages, 'pdf');
    warnings.push(...ocr.warnings);

    return {
      text: ocr.text,
      pageCount,
      warnings,
    };
  } finally {
    if (typeof doc?.destroy === 'function') {
      try {
        await doc.destroy();
      } catch {
        // no-op
      }
    }
  }
};

const extractImageText = async (file: File): Promise<ExtractedTextResult> => {
  const base64 = await imageFileToPngBase64(file);
  const ocr = await runVisionOcrOnPages([base64], 'image');
  return {
    text: ocr.text,
    pageCount: 1,
    warnings: ocr.warnings,
  };
};

const extractDocxText = async (file: File): Promise<ExtractedTextResult> => {
  const mammoth = (await import('mammoth')) as any;
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const warnings: string[] = [];
  if (Array.isArray(result?.messages)) {
    for (const message of result.messages) {
      const text = typeof message?.message === 'string' ? message.message : '';
      if (text) warnings.push(`DOCX note: ${text}`);
    }
  }

  return {
    text: normalizeWhitespace(typeof result?.value === 'string' ? result.value : ''),
    pageCount: 1,
    warnings,
  };
};

const extractTextFromFile = async (file: File, sourceKind: SourceKind): Promise<ExtractedTextResult> => {
  if (sourceKind === 'text') {
    return {
      text: normalizeWhitespace(await file.text()),
      pageCount: 1,
      warnings: [],
    };
  }

  if (sourceKind === 'pdf') {
    return extractPdfText(file);
  }

  if (sourceKind === 'docx') {
    return extractDocxText(file);
  }

  if (sourceKind === 'image') {
    return extractImageText(file);
  }

  return {
    text: '',
    pageCount: 1,
    warnings: ['Unsupported file type for text extraction.'],
  };
};

const normalizeCriteria = (criteria: RubricCriterion[]): RubricCriterion[] =>
  criteria
    .filter((criterion) => criterion && typeof criterion.name === 'string' && criterion.name.trim().length > 0)
    .map((criterion, index) => ({
      id: criterion.id?.trim() || `criterion_${index + 1}`,
      name: criterion.name.trim(),
      description: (criterion.description || '').trim(),
      maxPoints: Number.isFinite(Number(criterion.maxPoints)) ? Number(criterion.maxPoints) : 10,
    }));

const buildStoredRubricContext = (
  file: File,
  sourceKind: SourceKind,
  extractedText: string,
  criteriaCount: number,
  warnings: string[],
  textWasTruncated: boolean
): string => {
  const lines = [
    'Rubric source (uploaded file):',
    `File name: ${file.name}`,
    `Source type: ${sourceKind}`,
    `Size: ${formatSize(file.size)}`,
    `Extracted criteria: ${criteriaCount}`,
  ];

  if (textWasTruncated) {
    lines.push('Extraction note: rubric text was truncated to fit prompt budget.');
  }

  if (warnings.length > 0) {
    lines.push(`Warnings: ${warnings.join(' | ')}`);
  }

  if (extractedText) {
    lines.push('');
    lines.push('Condensed rubric text:');
    lines.push(extractedText);
  }

  return lines.join('\n');
};

const buildStoredSubmissionContent = (
  file: File,
  sourceKind: SourceKind,
  extractedText: string,
  warnings: string[],
  textWasTruncated: boolean
): string => {
  const lines = [
    `Student submission source: ${file.name}`,
    `Source type: ${sourceKind}`,
    `Size: ${formatSize(file.size)}`,
  ];

  if (warnings.length > 0) {
    lines.push(`Warnings: ${warnings.join(' | ')}`);
  }

  if (textWasTruncated) {
    lines.push('Extraction note: submission text was truncated to fit prompt budget.');
  }

  if (extractedText) {
    lines.push('');
    lines.push('Extracted submission text:');
    lines.push(extractedText);
  } else {
    lines.push('No readable text could be extracted from this file.');
  }

  return lines.join('\n');
};

export const processRubricUpload = async (file: File): Promise<ProcessedRubricDocument> => {
  const sourceKind = detectSourceKind(file);
  let extraction: ExtractedTextResult;
  try {
    extraction = await extractTextFromFile(file, sourceKind);
  } catch (error: any) {
    extraction = {
      text: '',
      pageCount: 1,
      warnings: [`Extraction failed: ${error?.message || 'Unknown extraction error'}`],
    };
  }
  const extractedText = normalizeWhitespace(extraction.text);
  const rubricTextForParsing = capText(extractedText, MAX_RUBRIC_PARSE_CHARS);
  const rubricTextForContext = capText(extractedText, MAX_RUBRIC_CONTEXT_CHARS);
  const warnings = [...extraction.warnings];

  let criteria: RubricCriterion[] = [];
  if (rubricTextForParsing.value) {
    try {
      const parsedCriteria = await parseRubricFromMarkdown(rubricTextForParsing.value);
      criteria = normalizeCriteria(parsedCriteria || []);
    } catch (error: any) {
      console.error(`[RubricExtraction][upload.parse.error] ${file.name}`, error);
      warnings.push('Rubric criteria extraction failed. You can add criteria manually.');
    }
  } else {
    warnings.push('No rubric text extracted. Add criteria manually if needed.');
  }

  if (rubricTextForParsing.wasTruncated) {
    warnings.push('Rubric parsing used a truncated text window due to size limits.');
  }

  const shouldStoreContext = rubricTextForContext.value.trim().length > 0;

  return {
    context: shouldStoreContext
      ? buildStoredRubricContext(
          file,
          sourceKind,
          rubricTextForContext.value,
          criteria.length,
          warnings,
          rubricTextForContext.wasTruncated
        )
      : '',
    sourceKind,
    pageCount: extraction.pageCount,
    fileData: createFileData(file),
    criteria,
    warnings,
  };
};

export const processSubmissionUpload = async (file: File): Promise<ProcessedSubmissionDocument> => {
  const sourceKind = detectSourceKind(file);
  let extraction: ExtractedTextResult;
  try {
    extraction = await extractTextFromFile(file, sourceKind);
  } catch (error: any) {
    extraction = {
      text: '',
      pageCount: 1,
      warnings: [`Extraction failed: ${error?.message || 'Unknown extraction error'}`],
    };
  }
  const extractedText = normalizeWhitespace(extraction.text);
  const capped = capText(extractedText, MAX_SUBMISSION_CHARS);

  return {
    content: buildStoredSubmissionContent(file, sourceKind, capped.value, extraction.warnings, capped.wasTruncated),
    sourceKind,
    pageCount: extraction.pageCount,
    fileData: createFileData(file),
    warnings: extraction.warnings,
  };
};
