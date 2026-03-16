/**
 * PDF processing for crawler
 * Handles PDF documents found during crawling
 */

// @ts-ignore - pdf-parse doesn't have proper TypeScript definitions
const pdfParse = require('pdf-parse');

export interface PDFProcessResult {
  text: string;
  metadata: {
    pages: number;
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modificationDate?: string;
  };
}

/**
 * Check if URL points to a PDF
 */
export function isPDFUrl(url: string): boolean {
  const urlLower = url.toLowerCase();
  return urlLower.endsWith('.pdf') || 
         urlLower.includes('.pdf?') ||
         urlLower.includes('content-type=application/pdf');
}

/**
 * Process PDF document
 */
export async function processPDF(url: string): Promise<PDFProcessResult> {
  console.log(`[PDF] Processing PDF: ${url}`);
  
  try {
    // Fetch PDF
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    console.log(`[PDF] Downloaded ${buffer.byteLength} bytes`);
    
    // Parse PDF
    const data = await pdfParse(Buffer.from(buffer));
    
    console.log(`[PDF] Extracted ${data.text.length} characters from ${data.numpages} pages`);
    
    return {
      text: data.text,
      metadata: {
        pages: data.numpages,
        title: data.info?.Title,
        author: data.info?.Author,
        subject: data.info?.Subject,
        creator: data.info?.Creator,
        producer: data.info?.Producer,
        creationDate: data.info?.CreationDate,
        modificationDate: data.info?.ModDate
      }
    };
    
  } catch (error) {
    console.error(`[PDF] Error processing PDF ${url}:`, error);
    throw error;
  }
}

/**
 * Clean and normalize PDF text
 */
export function cleanPDFText(text: string): string {
  return text
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove page breaks and form feeds
    .replace(/[\f\r]/g, '')
    // Remove multiple newlines
    .replace(/\n\s*\n/g, '\n\n')
    // Trim
    .trim();
}