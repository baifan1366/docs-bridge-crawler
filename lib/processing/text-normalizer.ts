/**
 * Text normalization for government documents
 * Handles encoding issues, duplicate content, and text cleanup
 */

export interface NormalizationResult {
  normalizedText: string;
  metadata: {
    originalLength: number;
    normalizedLength: number;
    duplicatesRemoved: number;
    encodingIssuesFixed: number;
    pageNumbersRemoved: number;
    whitespaceNormalized: boolean;
  };
}

export interface NormalizationOptions {
  removeDuplicateLines: boolean;
  normalizeWhitespace: boolean;
  fixEncoding: boolean;
  removePageNumbers: boolean;
  removeHeaders: boolean;
  removeFooters: boolean;
  minLineLength: number;
}

const DEFAULT_OPTIONS: NormalizationOptions = {
  removeDuplicateLines: true,
  normalizeWhitespace: true,
  fixEncoding: true,
  removePageNumbers: true,
  removeHeaders: true,
  removeFooters: true,
  minLineLength: 3
};

/**
 * Common patterns in government documents
 */
const PATTERNS = {
  // Page numbers
  pageNumbers: [
    /^Page\s+\d+$/i,
    /^\d+\s*$/,
    /^Halaman\s+\d+$/i,
    /^Muka\s+Surat\s+\d+$/i
  ],
  
  // Headers and footers
  headers: [
    /^(MINISTRY|KEMENTERIAN|DEPARTMENT|JABATAN)/i,
    /^(GOVERNMENT OF|KERAJAAN)/i,
    /^(OFFICIAL|RASMI|CONFIDENTIAL|SULIT)/i
  ],
  
  // Repeated navigation/menu items
  navigation: [
    /^(HOME|UTAMA|BACK|KEMBALI|NEXT|SETERUSNYA|PREVIOUS|SEBELUM)$/i,
    /^(MENU|NAVIGATION|NAVIGASI)$/i,
    /^(SEARCH|CARI|LOGIN|LOG MASUK)$/i
  ],
  
  // Common duplicated phrases
  duplicatedPhrases: [
    /^(Application Process|Proses Permohonan)$/i,
    /^(Required Documents|Dokumen Diperlukan)$/i,
    /^(Contact Information|Maklumat Hubungan)$/i,
    /^(Terms and Conditions|Terma dan Syarat)$/i
  ],
  
  // Encoding issues
  encodingIssues: [
    { pattern: /â€™/g, replacement: "'" },
    { pattern: /â€œ/g, replacement: '"' },
    { pattern: /â€/g, replacement: '"' },
    { pattern: /â€¢/g, replacement: '•' },
    { pattern: /â€"/g, replacement: '–' },
    { pattern: /Â/g, replacement: '' },
    { pattern: /\u00A0/g, replacement: ' ' }, // Non-breaking space
    { pattern: /\u2019/g, replacement: "'" }, // Right single quotation mark
    { pattern: /\u201C/g, replacement: '"' }, // Left double quotation mark
    { pattern: /\u201D/g, replacement: '"' }, // Right double quotation mark
    { pattern: /\u2013/g, replacement: '–' }, // En dash
    { pattern: /\u2014/g, replacement: '—' }, // Em dash
    { pattern: /\u2022/g, replacement: '•' }  // Bullet
  ]
};

export class TextNormalizer {
  private options: NormalizationOptions;

  constructor(options: Partial<NormalizationOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Main normalization method
   */
  normalize(text: string): NormalizationResult {
    console.log('[TEXT-NORMALIZER] Starting text normalization...');
    
    const originalLength = text.length;
    let normalizedText = text;
    let duplicatesRemoved = 0;
    let encodingIssuesFixed = 0;
    let pageNumbersRemoved = 0;

    // Step 1: Fix encoding issues
    if (this.options.fixEncoding) {
      const result = this.fixEncodingIssues(normalizedText);
      normalizedText = result.text;
      encodingIssuesFixed = result.fixesApplied;
    }

    // Step 2: Normalize whitespace
    if (this.options.normalizeWhitespace) {
      normalizedText = this.normalizeWhitespace(normalizedText);
    }

    // Step 3: Remove page numbers
    if (this.options.removePageNumbers) {
      const result = this.removePageNumbers(normalizedText);
      normalizedText = result.text;
      pageNumbersRemoved = result.removed;
    }

    // Step 4: Remove headers and footers
    if (this.options.removeHeaders || this.options.removeFooters) {
      normalizedText = this.removeHeadersAndFooters(normalizedText);
    }

    // Step 5: Remove duplicate lines
    if (this.options.removeDuplicateLines) {
      const result = this.removeDuplicateLines(normalizedText);
      normalizedText = result.text;
      duplicatesRemoved = result.removed;
    }

    // Step 6: Final cleanup
    normalizedText = this.finalCleanup(normalizedText);

    console.log(`[TEXT-NORMALIZER] Normalization complete: ${originalLength} → ${normalizedText.length} chars`);
    console.log(`[TEXT-NORMALIZER] Removed: ${duplicatesRemoved} duplicates, ${pageNumbersRemoved} page numbers, fixed ${encodingIssuesFixed} encoding issues`);

    return {
      normalizedText,
      metadata: {
        originalLength,
        normalizedLength: normalizedText.length,
        duplicatesRemoved,
        encodingIssuesFixed,
        pageNumbersRemoved,
        whitespaceNormalized: this.options.normalizeWhitespace
      }
    };
  }

  /**
   * Fix common encoding issues
   */
  private fixEncodingIssues(text: string): { text: string; fixesApplied: number } {
    let fixedText = text;
    let fixesApplied = 0;

    for (const issue of PATTERNS.encodingIssues) {
      const matches = fixedText.match(issue.pattern);
      if (matches) {
        fixesApplied += matches.length;
        fixedText = fixedText.replace(issue.pattern, issue.replacement);
      }
    }

    return { text: fixedText, fixesApplied };
  }

  /**
   * Normalize whitespace
   */
  private normalizeWhitespace(text: string): string {
    return text
      // Replace multiple spaces with single space
      .replace(/[ \t]+/g, ' ')
      // Replace multiple newlines with double newline
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      // Remove trailing whitespace from lines
      .replace(/[ \t]+$/gm, '')
      // Remove leading whitespace from lines (but preserve some indentation)
      .replace(/^[ \t]+/gm, (match) => match.length > 4 ? '    ' : '')
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  /**
   * Remove page numbers
   */
  private removePageNumbers(text: string): { text: string; removed: number } {
    const lines = text.split('\n');
    const filteredLines: string[] = [];
    let removed = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Check against page number patterns
      const isPageNumber = PATTERNS.pageNumbers.some(pattern => 
        pattern.test(trimmedLine)
      );

      if (isPageNumber) {
        removed++;
      } else {
        filteredLines.push(line);
      }
    }

    return { text: filteredLines.join('\n'), removed };
  }

  /**
   * Remove headers and footers
   */
  private removeHeadersAndFooters(text: string): string {
    const lines = text.split('\n');
    const filteredLines: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip if matches header patterns
      if (this.options.removeHeaders && this.isHeader(trimmedLine)) {
        continue;
      }

      // Skip if matches navigation patterns
      if (PATTERNS.navigation.some(pattern => pattern.test(trimmedLine))) {
        continue;
      }

      filteredLines.push(line);
    }

    return filteredLines.join('\n');
  }

  /**
   * Check if line is a header
   */
  private isHeader(line: string): boolean {
    return PATTERNS.headers.some(pattern => pattern.test(line));
  }

  /**
   * Remove duplicate lines
   */
  private removeDuplicateLines(text: string): { text: string; removed: number } {
    const lines = text.split('\n');
    const seenLines = new Set<string>();
    const filteredLines: string[] = [];
    let removed = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (trimmedLine.length < this.options.minLineLength) {
        filteredLines.push(line);
        continue;
      }

      // Check for exact duplicates
      if (seenLines.has(trimmedLine)) {
        removed++;
        continue;
      }

      // Check for common duplicated phrases
      const isDuplicatedPhrase = PATTERNS.duplicatedPhrases.some(pattern => 
        pattern.test(trimmedLine)
      );

      if (isDuplicatedPhrase && seenLines.has(`PHRASE:${trimmedLine.toLowerCase()}`)) {
        removed++;
        continue;
      }

      seenLines.add(trimmedLine);
      if (isDuplicatedPhrase) {
        seenLines.add(`PHRASE:${trimmedLine.toLowerCase()}`);
      }
      
      filteredLines.push(line);
    }

    return { text: filteredLines.join('\n'), removed };
  }

  /**
   * Final cleanup
   */
  private finalCleanup(text: string): string {
    return text
      // Remove excessive blank lines at start and end
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
      // Ensure consistent paragraph spacing
      .replace(/\n{3,}/g, '\n\n')
      // Final whitespace normalization
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  /**
   * Remove specific repeated content patterns
   */
  removeRepeatedContent(text: string, maxRepeats: number = 2): string {
    const lines = text.split('\n');
    const result: string[] = [];
    const lineCount = new Map<string, number>();

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.length < this.options.minLineLength) {
        result.push(line);
        continue;
      }

      const count = lineCount.get(trimmedLine) || 0;
      
      if (count < maxRepeats) {
        lineCount.set(trimmedLine, count + 1);
        result.push(line);
      }
    }

    return result.join('\n');
  }

  /**
   * Detect and fix common OCR errors
   */
  fixOCRErrors(text: string): string {
    const ocrFixes = [
      // Common OCR character substitutions
      { pattern: /\b1\b/g, replacement: 'I' }, // 1 -> I in context
      { pattern: /\b0\b/g, replacement: 'O' }, // 0 -> O in context
      { pattern: /rn/g, replacement: 'm' },     // rn -> m
      { pattern: /\|/g, replacement: 'l' },     // | -> l
      
      // Malaysian specific OCR fixes
      { pattern: /Kerajaan/gi, replacement: 'Kerajaan' },
      { pattern: /Malaysia/gi, replacement: 'Malaysia' },
      { pattern: /Kementerian/gi, replacement: 'Kementerian' }
    ];

    let fixedText = text;
    for (const fix of ocrFixes) {
      fixedText = fixedText.replace(fix.pattern, fix.replacement);
    }

    return fixedText;
  }
}

/**
 * Factory function for easy usage
 */
export function normalizeText(text: string, options?: Partial<NormalizationOptions>): NormalizationResult {
  const normalizer = new TextNormalizer(options);
  return normalizer.normalize(text);
}