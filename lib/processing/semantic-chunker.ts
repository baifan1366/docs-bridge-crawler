/**
 * Semantic chunking for RAG optimization
 * Implements intelligent chunking based on content structure and meaning
 */

import { DocumentStructure, DocumentSection } from './structure-parser';

export interface SemanticChunk {
  id: string;
  text: string;
  tokens: number;
  type: 'title' | 'section' | 'paragraph' | 'list' | 'table' | 'mixed';
  metadata: {
    source_section: string;
    section_level: number;
    position: number;
    overlap_with_previous: boolean;
    overlap_with_next: boolean;
    semantic_boundaries: string[];
    topic_keywords: string[];
  };
}

export interface ChunkingResult {
  chunks: SemanticChunk[];
  metadata: {
    total_chunks: number;
    avg_chunk_size: number;
    chunking_method: 'semantic' | 'paragraph' | 'sentence' | 'hybrid';
    overlap_ratio: number;
    boundary_preservation: number;
  };
}

export interface ChunkingOptions {
  target_chunk_size: number;    // Target tokens per chunk (400-600)
  max_chunk_size: number;       // Maximum tokens per chunk
  min_chunk_size: number;       // Minimum tokens per chunk
  overlap_size: number;         // Overlap tokens (80-120)
  preserve_boundaries: boolean; // Keep semantic boundaries intact
  include_context: boolean;     // Include section context in chunks
  split_long_paragraphs: boolean; // Split paragraphs longer than max_chunk_size
}

const DEFAULT_OPTIONS: ChunkingOptions = {
  target_chunk_size: 500,
  max_chunk_size: 600,
  min_chunk_size: 200,
  overlap_size: 100,
  preserve_boundaries: true,
  include_context: true,
  split_long_paragraphs: true
};

/**
 * Government document topic keywords for semantic analysis
 */
const TOPIC_KEYWORDS = {
  eligibility: ['eligible', 'qualify', 'requirement', 'criteria', 'layak', 'syarat', 'kelayakan'],
  application: ['apply', 'application', 'submit', 'form', 'mohon', 'permohonan', 'borang'],
  documents: ['document', 'certificate', 'proof', 'dokumen', 'sijil', 'bukti'],
  process: ['process', 'procedure', 'step', 'proses', 'prosedur', 'langkah'],
  benefits: ['benefit', 'assistance', 'support', 'bantuan', 'faedah', 'sokongan'],
  contact: ['contact', 'enquiry', 'office', 'hubungi', 'pertanyaan', 'pejabat'],
  deadline: ['deadline', 'due date', 'before', 'tarikh', 'sebelum', 'had masa'],
  fee: ['fee', 'cost', 'payment', 'yuran', 'kos', 'bayaran']
};

export class SemanticChunker {
  private options: ChunkingOptions;

  constructor(options: Partial<ChunkingOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Main chunking method using document structure
   */
  chunkWithStructure(structure: DocumentStructure): ChunkingResult {
    console.log('[SEMANTIC-CHUNKER] Starting semantic chunking...');
    console.log(`[SEMANTIC-CHUNKER] Document has ${structure.sections.length} sections`);

    const chunks: SemanticChunk[] = [];
    let chunkCounter = 0;

    // Process each section
    for (let i = 0; i < structure.sections.length; i++) {
      const section = structure.sections[i];
      const sectionChunks = this.chunkSection(section, chunkCounter, i);
      chunks.push(...sectionChunks);
      chunkCounter += sectionChunks.length;
    }

    // Add overlaps between chunks
    this.addOverlaps(chunks);

    const metadata = this.calculateMetadata(chunks, 'semantic');

    console.log(`[SEMANTIC-CHUNKER] Created ${chunks.length} semantic chunks`);
    console.log(`[SEMANTIC-CHUNKER] Average chunk size: ${metadata.avg_chunk_size} tokens`);

    return { chunks, metadata };
  }

  /**
   * Fallback chunking for unstructured text
   */
  chunkPlainText(text: string): ChunkingResult {
    console.log('[SEMANTIC-CHUNKER] Chunking plain text...');

    const chunks: SemanticChunk[] = [];
    
    // Try paragraph-based chunking first
    const paragraphs = this.splitIntoParagraphs(text);
    
    if (paragraphs.length > 1) {
      const paragraphChunks = this.chunkByParagraphs(paragraphs);
      chunks.push(...paragraphChunks);
    } else {
      // Fallback to sentence-based chunking
      const sentenceChunks = this.chunkBySentences(text);
      chunks.push(...sentenceChunks);
    }

    this.addOverlaps(chunks);
    const metadata = this.calculateMetadata(chunks, paragraphs.length > 1 ? 'paragraph' : 'sentence');

    console.log(`[SEMANTIC-CHUNKER] Created ${chunks.length} chunks from plain text`);

    return { chunks, metadata };
  }

  /**
   * Chunk a single section
   */
  private chunkSection(section: DocumentSection, startId: number, position: number): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];
    let chunkId = startId;

    // Handle section title and content
    const sectionText = this.prepareSectionText(section);
    const tokens = this.estimateTokens(sectionText);

    if (tokens <= this.options.max_chunk_size) {
      // Section fits in one chunk
      chunks.push(this.createChunk(
        `chunk-${chunkId++}`,
        sectionText,
        tokens,
        'section',
        section.title,
        section.level,
        position
      ));
    } else {
      // Split section into multiple chunks
      const sectionChunks = this.splitLargeSection(section, chunkId, position);
      chunks.push(...sectionChunks);
      chunkId += sectionChunks.length;
    }

    // Process subsections recursively
    for (let i = 0; i < section.subsections.length; i++) {
      const subsectionChunks = this.chunkSection(section.subsections[i], chunkId, position);
      chunks.push(...subsectionChunks);
      chunkId += subsectionChunks.length;
    }

    return chunks;
  }

  /**
   * Prepare section text with context
   */
  private prepareSectionText(section: DocumentSection): string {
    let text = '';

    if (this.options.include_context && section.title) {
      text += `${section.title}\n\n`;
    }

    text += section.content;

    // Add bullet points if available
    if (section.metadata.bulletPoints.length > 0) {
      text += '\n\n' + section.metadata.bulletPoints.map(point => `• ${point}`).join('\n');
    }

    return text.trim();
  }

  /**
   * Split large section into chunks
   */
  private splitLargeSection(section: DocumentSection, startId: number, position: number): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];
    let chunkId = startId;

    // Split by paragraphs first
    const paragraphs = this.splitIntoParagraphs(section.content);
    let currentChunk = this.options.include_context && section.title ? `${section.title}\n\n` : '';
    let currentTokens = this.estimateTokens(currentChunk);

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);
      
      // Check if adding this paragraph would exceed max size
      if (currentTokens + paragraphTokens > this.options.max_chunk_size && currentChunk.trim()) {
        // Create chunk from current content
        chunks.push(this.createChunk(
          `chunk-${chunkId++}`,
          currentChunk.trim(),
          currentTokens,
          'section',
          section.title,
          section.level,
          position
        ));

        // Start new chunk with overlap
        const overlap = this.getOverlapText(currentChunk);
        currentChunk = overlap + paragraph;
        currentTokens = this.estimateTokens(currentChunk);
      } else {
        currentChunk += (currentChunk.trim() ? '\n\n' : '') + paragraph;
        currentTokens += paragraphTokens;
      }
    }

    // Add final chunk if there's remaining content
    if (currentChunk.trim() && currentTokens >= this.options.min_chunk_size) {
      chunks.push(this.createChunk(
        `chunk-${chunkId++}`,
        currentChunk.trim(),
        currentTokens,
        'section',
        section.title,
        section.level,
        position
      ));
    }

    return chunks;
  }

  /**
   * Chunk by paragraphs
   */
  private chunkByParagraphs(paragraphs: string[]): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];
    let chunkId = 0;
    let currentChunk = '';
    let currentTokens = 0;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);
      
      if (currentTokens + paragraphTokens > this.options.max_chunk_size && currentChunk) {
        chunks.push(this.createChunk(
          `chunk-${chunkId++}`,
          currentChunk.trim(),
          currentTokens,
          'paragraph',
          'Content',
          1,
          chunkId
        ));

        const overlap = this.getOverlapText(currentChunk);
        currentChunk = overlap + paragraph;
        currentTokens = this.estimateTokens(currentChunk);
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        currentTokens += paragraphTokens;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(this.createChunk(
        `chunk-${chunkId++}`,
        currentChunk.trim(),
        currentTokens,
        'paragraph',
        'Content',
        1,
        chunkId
      ));
    }

    return chunks;
  }

  /**
   * Chunk by sentences (fallback)
   */
  private chunkBySentences(text: string): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];
    const sentences = this.splitIntoSentences(text);
    
    let chunkId = 0;
    let currentChunk = '';
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);
      
      if (currentTokens + sentenceTokens > this.options.max_chunk_size && currentChunk) {
        chunks.push(this.createChunk(
          `chunk-${chunkId++}`,
          currentChunk.trim(),
          currentTokens,
          'mixed',
          'Content',
          1,
          chunkId
        ));

        const overlap = this.getOverlapText(currentChunk);
        currentChunk = overlap + sentence;
        currentTokens = this.estimateTokens(currentChunk);
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
        currentTokens += sentenceTokens;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(this.createChunk(
        `chunk-${chunkId++}`,
        currentChunk.trim(),
        currentTokens,
        'mixed',
        'Content',
        1,
        chunkId
      ));
    }

    return chunks;
  }

  /**
   * Create a semantic chunk
   */
  private createChunk(
    id: string,
    text: string,
    tokens: number,
    type: SemanticChunk['type'],
    sourceSection: string,
    sectionLevel: number,
    position: number
  ): SemanticChunk {
    return {
      id,
      text,
      tokens,
      type,
      metadata: {
        source_section: sourceSection,
        section_level: sectionLevel,
        position,
        overlap_with_previous: false,
        overlap_with_next: false,
        semantic_boundaries: this.identifySemanticBoundaries(text),
        topic_keywords: this.extractTopicKeywords(text)
      }
    };
  }

  /**
   * Add overlaps between chunks
   */
  private addOverlaps(chunks: SemanticChunk[]): void {
    for (let i = 0; i < chunks.length - 1; i++) {
      const currentChunk = chunks[i];
      const nextChunk = chunks[i + 1];
      
      // Add overlap text to next chunk
      const overlapText = this.getOverlapText(currentChunk.text);
      if (overlapText) {
        nextChunk.text = overlapText + '\n\n' + nextChunk.text;
        nextChunk.tokens = this.estimateTokens(nextChunk.text);
        nextChunk.metadata.overlap_with_previous = true;
        currentChunk.metadata.overlap_with_next = true;
      }
    }
  }

  /**
   * Get overlap text from end of chunk
   */
  private getOverlapText(text: string): string {
    const sentences = this.splitIntoSentences(text);
    let overlapText = '';
    let overlapTokens = 0;

    // Take sentences from the end until we reach overlap size
    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentence = sentences[i];
      const sentenceTokens = this.estimateTokens(sentence);
      
      if (overlapTokens + sentenceTokens <= this.options.overlap_size) {
        overlapText = sentence + (overlapText ? ' ' + overlapText : '');
        overlapTokens += sentenceTokens;
      } else {
        break;
      }
    }

    return overlapText;
  }

  /**
   * Split text into paragraphs
   */
  private splitIntoParagraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 10); // Filter out very short fragments
  }

  /**
   * Identify semantic boundaries in text
   */
  private identifySemanticBoundaries(text: string): string[] {
    const boundaries: string[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Check for section headers
      if (/^[A-Z][A-Z\s]+:?$/.test(trimmed) || /^\d+\./.test(trimmed)) {
        boundaries.push('section_header');
      }
      
      // Check for list items
      if (/^[•\-\*]/.test(trimmed) || /^\d+\)/.test(trimmed)) {
        boundaries.push('list_item');
      }
      
      // Check for questions
      if (trimmed.endsWith('?')) {
        boundaries.push('question');
      }
    }

    return [...new Set(boundaries)]; // Remove duplicates
  }

  /**
   * Extract topic keywords from text
   */
  private extractTopicKeywords(text: string): string[] {
    const keywords: string[] = [];
    const lowerText = text.toLowerCase();

    for (const [topic, topicKeywords] of Object.entries(TOPIC_KEYWORDS)) {
      const matches = topicKeywords.filter(keyword => lowerText.includes(keyword));
      if (matches.length > 0) {
        keywords.push(topic);
      }
    }

    return keywords;
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token for most languages
    // More accurate for government documents which tend to be formal
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Calculate chunking metadata
   */
  private calculateMetadata(chunks: SemanticChunk[], method: string): ChunkingResult['metadata'] {
    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokens, 0);
    const avgChunkSize = totalTokens / chunks.length;
    
    const chunksWithOverlap = chunks.filter(chunk => 
      chunk.metadata.overlap_with_previous || chunk.metadata.overlap_with_next
    ).length;
    const overlapRatio = chunksWithOverlap / chunks.length;
    
    const chunksWithBoundaries = chunks.filter(chunk => 
      chunk.metadata.semantic_boundaries.length > 0
    ).length;
    const boundaryPreservation = chunksWithBoundaries / chunks.length;

    return {
      total_chunks: chunks.length,
      avg_chunk_size: Math.round(avgChunkSize),
      chunking_method: method as any,
      overlap_ratio: Math.round(overlapRatio * 100) / 100,
      boundary_preservation: Math.round(boundaryPreservation * 100) / 100
    };
  }
}

/**
 * Factory functions for easy usage
 */
export function chunkWithStructure(structure: DocumentStructure, options?: Partial<ChunkingOptions>): ChunkingResult {
  const chunker = new SemanticChunker(options);
  return chunker.chunkWithStructure(structure);
}

export function chunkPlainText(text: string, options?: Partial<ChunkingOptions>): ChunkingResult {
  const chunker = new SemanticChunker(options);
  return chunker.chunkPlainText(text);
}