/**
 * Advanced document chunking system for large documents
 * Handles intelligent splitting and chunk management
 */

import { createHash } from 'crypto';
import { CRAWLER_CONFIG } from '../crawler/config';

export interface DocumentChunk {
  id?: string;
  document_id: string;
  chunk_text: string;
  chunk_index: number;
  chunk_hash: string;
  token_count: number;
  section_heading?: string;
  section_level?: number;
  is_section_chunk: boolean;
  metadata: {
    start_position: number;
    end_position: number;
    chunk_type: 'paragraph' | 'section' | 'table' | 'list';
    parent_section?: string;
  };
}

export interface ChunkingResult {
  chunks: DocumentChunk[];
  total_chunks: number;
  total_tokens: number;
  chunking_method: string;
  processing_stats: {
    sections_found: number;
    paragraphs_processed: number;
    tables_processed: number;
    lists_processed: number;
  };
}

/**
 * Advanced document chunker with section awareness
 */
export class DocumentChunker {
  private maxChunkSize: number;
  private overlapSize: number;
  private minChunkSize: number;

  constructor(options: {
    maxChunkSize?: number;
    overlapSize?: number;
    minChunkSize?: number;
  } = {}) {
    this.maxChunkSize = options.maxChunkSize || CRAWLER_CONFIG.MAX_CHUNK_SIZE;
    this.overlapSize = options.overlapSize || 100;
    this.minChunkSize = options.minChunkSize || 200;
  }

  /**
   * Main chunking method - tries section-based first, falls back to paragraph-based
   */
  async chunkDocument(
    documentId: string,
    content: string,
    html?: string
  ): Promise<ChunkingResult> {
    console.log(`[CHUNKER] Processing document ${documentId}, content length: ${content.length}`);

    // Try section-based chunking first
    if (html) {
      const sectionResult = await this.chunkBySections(documentId, content, html);
      if (sectionResult.chunks.length > 0) {
        console.log(`[CHUNKER] Used section-based chunking: ${sectionResult.chunks.length} chunks`);
        return sectionResult;
      }
    }

    // Fall back to paragraph-based chunking
    const paragraphResult = await this.chunkByParagraphs(documentId, content);
    console.log(`[CHUNKER] Used paragraph-based chunking: ${paragraphResult.chunks.length} chunks`);
    return paragraphResult;
  }

  /**
   * Section-based chunking using HTML structure
   */
  private async chunkBySections(
    documentId: string,
    content: string,
    html: string
  ): Promise<ChunkingResult> {
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);
    
    const chunks: DocumentChunk[] = [];
    const stats = {
      sections_found: 0,
      paragraphs_processed: 0,
      tables_processed: 0,
      lists_processed: 0
    };

    let chunkIndex = 0;
    let currentPosition = 0;

    // Process main sections (h1, h2, h3, etc.)
    $('h1, h2, h3, h4, h5, h6').each((_, element) => {
      const $section = $(element);
      const sectionLevel = parseInt(element.tagName.substring(1));
      const sectionHeading = $section.text().trim();
      
      if (!sectionHeading) return;

      stats.sections_found++;

      // Get content until next heading of same or higher level
      const sectionContent = this.extractSectionContent($, element, sectionLevel);
      
      if (sectionContent.length >= this.minChunkSize) {
        const sectionChunks = this.splitLargeContent(
          sectionContent,
          documentId,
          chunkIndex,
          currentPosition,
          {
            section_heading: sectionHeading,
            section_level: sectionLevel,
            is_section_chunk: true,
            chunk_type: 'section'
          }
        );

        chunks.push(...sectionChunks);
        chunkIndex += sectionChunks.length;
        currentPosition += sectionContent.length;
      }
    });

    // Process tables separately
    $('table').each((_, element) => {
      const tableText = $(element).text().trim();
      if (tableText.length >= this.minChunkSize) {
        stats.tables_processed++;
        
        const tableChunk = this.createChunk(
          documentId,
          tableText,
          chunkIndex++,
          currentPosition,
          {
            chunk_type: 'table',
            is_section_chunk: false
          }
        );
        
        chunks.push(tableChunk);
        currentPosition += tableText.length;
      }
    });

    return {
      chunks,
      total_chunks: chunks.length,
      total_tokens: chunks.reduce((sum, chunk) => sum + chunk.token_count, 0),
      chunking_method: 'section-based',
      processing_stats: stats
    };
  }

  /**
   * Paragraph-based chunking for plain text
   */
  private async chunkByParagraphs(
    documentId: string,
    content: string
  ): Promise<ChunkingResult> {
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const chunks: DocumentChunk[] = [];
    const stats = {
      sections_found: 0,
      paragraphs_processed: paragraphs.length,
      tables_processed: 0,
      lists_processed: 0
    };

    let chunkIndex = 0;
    let currentPosition = 0;
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      const trimmedParagraph = paragraph.trim();
      
      // Check if adding this paragraph would exceed chunk size
      if (currentChunk.length + trimmedParagraph.length > this.maxChunkSize && currentChunk.length > 0) {
        // Create chunk from current content
        const chunk = this.createChunk(
          documentId,
          currentChunk,
          chunkIndex++,
          currentPosition - currentChunk.length,
          { chunk_type: 'paragraph', is_section_chunk: false }
        );
        chunks.push(chunk);
        
        // Start new chunk with overlap
        const overlapText = this.getOverlapText(currentChunk);
        currentChunk = overlapText + trimmedParagraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
      }
      
      currentPosition += trimmedParagraph.length + 2; // +2 for \n\n
    }

    // Add final chunk if there's remaining content
    if (currentChunk.trim().length >= this.minChunkSize) {
      const chunk = this.createChunk(
        documentId,
        currentChunk,
        chunkIndex++,
        currentPosition - currentChunk.length,
        { chunk_type: 'paragraph', is_section_chunk: false }
      );
      chunks.push(chunk);
    }

    return {
      chunks,
      total_chunks: chunks.length,
      total_tokens: chunks.reduce((sum, chunk) => sum + chunk.token_count, 0),
      chunking_method: 'paragraph-based',
      processing_stats: stats
    };
  }

  /**
   * Extract content for a section until next heading of same or higher level
   */
  private extractSectionContent($: any, headingElement: any, level: number): string {
    const content: string[] = [];
    let current = $(headingElement).next();
    
    while (current.length > 0) {
      const tagName = current.prop('tagName')?.toLowerCase();
      
      // Stop if we hit another heading of same or higher level
      if (tagName && tagName.match(/^h[1-6]$/)) {
        const currentLevel = parseInt(tagName.substring(1));
        if (currentLevel <= level) {
          break;
        }
      }
      
      const text = current.text().trim();
      if (text) {
        content.push(text);
      }
      
      current = current.next();
    }
    
    return content.join('\n\n');
  }

  /**
   * Split large content into smaller chunks
   */
  private splitLargeContent(
    content: string,
    documentId: string,
    startIndex: number,
    startPosition: number,
    baseMetadata: any
  ): DocumentChunk[] {
    if (content.length <= this.maxChunkSize) {
      return [this.createChunk(documentId, content, startIndex, startPosition, baseMetadata)];
    }

    const chunks: DocumentChunk[] = [];
    let chunkIndex = startIndex;
    let position = startPosition;
    let remaining = content;

    while (remaining.length > 0) {
      let chunkSize = Math.min(this.maxChunkSize, remaining.length);
      
      // Try to break at sentence boundary
      if (chunkSize < remaining.length) {
        const lastSentence = remaining.substring(0, chunkSize).lastIndexOf('.');
        if (lastSentence > chunkSize * 0.7) { // Don't break too early
          chunkSize = lastSentence + 1;
        }
      }

      const chunkText = remaining.substring(0, chunkSize);
      const chunk = this.createChunk(documentId, chunkText, chunkIndex++, position, baseMetadata);
      chunks.push(chunk);

      // Move to next chunk with overlap
      const overlapStart = Math.max(0, chunkSize - this.overlapSize);
      remaining = remaining.substring(overlapStart);
      position += overlapStart;
    }

    return chunks;
  }

  /**
   * Create a document chunk with metadata
   */
  private createChunk(
    documentId: string,
    text: string,
    index: number,
    startPosition: number,
    options: any
  ): DocumentChunk {
    const chunkHash = createHash('sha256').update(text).digest('hex');
    
    return {
      document_id: documentId,
      chunk_text: text,
      chunk_index: index,
      chunk_hash: chunkHash,
      token_count: this.estimateTokenCount(text),
      section_heading: options.section_heading,
      section_level: options.section_level,
      is_section_chunk: options.is_section_chunk || false,
      metadata: {
        start_position: startPosition,
        end_position: startPosition + text.length,
        chunk_type: options.chunk_type || 'paragraph',
        parent_section: options.parent_section
      }
    };
  }

  /**
   * Get overlap text from the end of current chunk
   */
  private getOverlapText(text: string): string {
    if (text.length <= this.overlapSize) return text;
    
    const overlapText = text.substring(text.length - this.overlapSize);
    
    // Try to start at sentence boundary
    const sentenceStart = overlapText.indexOf('. ');
    if (sentenceStart > 0) {
      return overlapText.substring(sentenceStart + 2);
    }
    
    return overlapText;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for most languages
    return Math.ceil(text.length / 4);
  }
}

/**
 * Factory function to create chunker with default settings
 */
export function createDocumentChunker(options?: {
  maxChunkSize?: number;
  overlapSize?: number;
  minChunkSize?: number;
}): DocumentChunker {
  return new DocumentChunker(options);
}