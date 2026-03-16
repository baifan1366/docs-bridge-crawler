/**
 * Enhanced metadata generation for RAG optimization
 * Creates rich metadata for filtering and retrieval
 */

import { DocumentStructure } from './structure-parser';
import { SemanticChunk } from './semantic-chunker';

export interface EnhancedMetadata {
  // Basic metadata
  source: string;
  url: string;
  language: string;
  document_title: string;
  
  // Content classification
  topic: string[];
  document_type: 'policy' | 'procedure' | 'form' | 'guide' | 'announcement' | 'law' | 'regulation';
  content_category: 'eligibility' | 'application' | 'benefits' | 'requirements' | 'process' | 'contact' | 'general';
  
  // Government specific
  ministry: string;
  department: string;
  program_name?: string;
  target_audience: string[];
  
  // Content structure
  section: string;
  subsection?: string;
  section_level: number;
  
  // Temporal metadata
  last_updated?: string;
  effective_date?: string;
  expiry_date?: string;
  
  // Content quality indicators
  confidence_score: number;
  completeness_score: number;
  
  // Search optimization
  keywords: string[];
  entities: string[];
  
  // Chunk specific
  chunk_type: 'title' | 'section' | 'paragraph' | 'list' | 'table' | 'mixed';
  chunk_position: number;
  has_overlap: boolean;
}

export interface MetadataGenerationOptions {
  extractEntities: boolean;
  detectDates: boolean;
  classifyContent: boolean;
  extractKeywords: boolean;
  calculateScores: boolean;
}

const DEFAULT_OPTIONS: MetadataGenerationOptions = {
  extractEntities: true,
  detectDates: true,
  classifyContent: true,
  extractKeywords: true,
  calculateScores: true
};

/**
 * Government classification patterns
 */
const CLASSIFICATION_PATTERNS = {
  // Document types
  document_types: {
    policy: /policy|dasar|polisi/i,
    procedure: /procedure|prosedur|tatacara/i,
    form: /form|borang|formulir/i,
    guide: /guide|panduan|manual/i,
    announcement: /announcement|pengumuman|notis/i,
    law: /act|law|akta|undang/i,
    regulation: /regulation|peraturan|kaedah/i
  },
  
  // Content categories
  content_categories: {
    eligibility: /eligib|layak|qualify|syarat|criteria/i,
    application: /apply|mohon|permohonan|submit/i,
    benefits: /benefit|bantuan|faedah|assistance/i,
    requirements: /require|perlu|dokumen|document/i,
    process: /process|proses|step|langkah/i,
    contact: /contact|hubungi|enquiry|pertanyaan/i
  },
  
  // Ministries and departments
  ministries: {
    'Ministry of Health': /ministry of health|kementerian kesihatan|moh/i,
    'Ministry of Education': /ministry of education|kementerian pendidikan|moe/i,
    'Ministry of Finance': /ministry of finance|kementerian kewangan|mof/i,
    'Ministry of Home Affairs': /ministry of home affairs|kementerian dalam negeri/i,
    'Ministry of Women': /ministry of women|kementerian wanita/i,
    'Prime Minister\'s Department': /prime minister|jabatan perdana menteri|jpm/i
  },
  
  // Target audiences
  audiences: {
    'Citizens': /citizen|rakyat|public|awam/i,
    'Students': /student|pelajar|murid/i,
    'Businesses': /business|perniagaan|company|syarikat/i,
    'Elderly': /elderly|warga emas|senior/i,
    'Youth': /youth|belia|remaja/i,
    'Women': /women|wanita|perempuan/i,
    'Disabled': /disabled|oku|kurang upaya/i
  }
};

/**
 * Entity extraction patterns
 */
const ENTITY_PATTERNS = {
  // Malaysian specific entities
  ic_number: /\d{6}-\d{2}-\d{4}/g,
  phone: /0\d{1,2}-\d{7,8}|\+60\d{1,2}-\d{7,8}/g,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // Dates
  dates: /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Januari|Februari|Mac|April|Mei|Jun|Julai|Ogos|September|Oktober|November|Disember)\s+\d{2,4}/gi,
  
  // Money amounts
  money: /RM\s*\d+(?:,\d{3})*(?:\.\d{2})?|\d+(?:,\d{3})*(?:\.\d{2})?\s*ringgit/gi,
  
  // Addresses
  addresses: /\d+[A-Za-z]?,?\s+[A-Za-z\s]+,\s+\d{5}\s+[A-Za-z\s]+/g
};

export class MetadataGenerator {
  private options: MetadataGenerationOptions;

  constructor(options: Partial<MetadataGenerationOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate enhanced metadata for a chunk
   */
  generateForChunk(
    chunk: SemanticChunk,
    structure: DocumentStructure,
    sourceUrl: string,
    sourceName: string
  ): EnhancedMetadata {
    console.log(`[METADATA-GENERATOR] Generating metadata for chunk: ${chunk.id}`);

    const baseMetadata = this.generateBaseMetadata(structure, sourceUrl, sourceName);
    const contentMetadata = this.analyzeContent(chunk.text);
    const chunkMetadata = this.generateChunkMetadata(chunk);

    return {
      // Required base properties
      source: sourceName,
      url: sourceUrl,
      language: structure.language || 'en',
      document_title: structure.title || 'Untitled',
      
      // Content classification
      topic: contentMetadata.topic || [],
      document_type: contentMetadata.document_type || 'guide',
      content_category: contentMetadata.content_category || 'general',
      
      // Government specific
      ministry: baseMetadata.ministry || 'Unknown',
      department: baseMetadata.department || 'Unknown',
      program_name: chunkMetadata.program_name,
      target_audience: baseMetadata.target_audience || [],
      
      // Content structure
      section: chunk.metadata.source_section,
      subsection: undefined,
      section_level: chunk.metadata.section_level,
      
      // Temporal metadata
      last_updated: contentMetadata.last_updated,
      effective_date: contentMetadata.effective_date,
      expiry_date: contentMetadata.expiry_date,
      
      // Content quality indicators
      confidence_score: contentMetadata.confidence_score || 0.5,
      completeness_score: contentMetadata.completeness_score || 0.5,
      
      // Search optimization
      keywords: contentMetadata.keywords || [],
      entities: contentMetadata.entities || [],
      
      // Chunk specific
      chunk_type: chunk.type,
      chunk_position: chunk.metadata.position,
      has_overlap: chunk.metadata.overlap_with_previous || chunk.metadata.overlap_with_next
    };
  }

  /**
   * Generate base metadata from document structure
   */
  private generateBaseMetadata(
    structure: DocumentStructure,
    sourceUrl: string,
    sourceName: string
  ): Partial<EnhancedMetadata> {
    const ministry = this.detectMinistry(structure.title + ' ' + sourceName);
    const department = this.extractDepartment(sourceName);
    
    return {
      source: sourceName,
      url: sourceUrl,
      language: structure.language,
      document_title: structure.title,
      ministry,
      department,
      target_audience: this.detectTargetAudience(structure.title)
    };
  }

  /**
   * Analyze content for classification and extraction
   */
  private analyzeContent(text: string): Partial<EnhancedMetadata> {
    const metadata: Partial<EnhancedMetadata> = {};

    if (this.options.classifyContent) {
      metadata.document_type = this.classifyDocumentType(text);
      metadata.content_category = this.classifyContentCategory(text);
      metadata.topic = this.extractTopics(text);
    }

    if (this.options.extractKeywords) {
      metadata.keywords = this.extractKeywords(text);
    }

    if (this.options.extractEntities) {
      metadata.entities = this.extractEntities(text);
    }

    if (this.options.detectDates) {
      const dates = this.extractDates(text);
      if (dates.effective_date) metadata.effective_date = dates.effective_date;
      if (dates.expiry_date) metadata.expiry_date = dates.expiry_date;
      if (dates.last_updated) metadata.last_updated = dates.last_updated;
    }

    if (this.options.calculateScores) {
      metadata.confidence_score = this.calculateConfidenceScore(text);
      metadata.completeness_score = this.calculateCompletenessScore(text);
    }

    return metadata;
  }

  /**
   * Generate chunk-specific metadata
   */
  private generateChunkMetadata(chunk: SemanticChunk): Partial<EnhancedMetadata> {
    const programName = this.extractProgramName(chunk.text);
    
    return {
      program_name: programName
    };
  }

  /**
   * Classify document type
   */
  private classifyDocumentType(text: string): EnhancedMetadata['document_type'] {
    for (const [type, pattern] of Object.entries(CLASSIFICATION_PATTERNS.document_types)) {
      if (pattern.test(text)) {
        return type as EnhancedMetadata['document_type'];
      }
    }
    return 'guide'; // Default
  }

  /**
   * Classify content category
   */
  private classifyContentCategory(text: string): EnhancedMetadata['content_category'] {
    const scores: Record<string, number> = {};
    
    for (const [category, pattern] of Object.entries(CLASSIFICATION_PATTERNS.content_categories)) {
      const matches = text.match(pattern);
      scores[category] = matches ? matches.length : 0;
    }

    // Return category with highest score
    const bestCategory = Object.entries(scores).reduce((a, b) => 
      scores[a[0]] > scores[b[0]] ? a : b
    )[0];

    return bestCategory as EnhancedMetadata['content_category'] || 'general';
  }

  /**
   * Extract topics from text
   */
  private extractTopics(text: string): string[] {
    const topics: string[] = [];
    const lowerText = text.toLowerCase();

    // Government service topics
    const topicKeywords = {
      healthcare: ['health', 'medical', 'hospital', 'kesihatan', 'perubatan'],
      education: ['education', 'school', 'university', 'pendidikan', 'sekolah'],
      finance: ['finance', 'tax', 'loan', 'kewangan', 'cukai', 'pinjaman'],
      housing: ['housing', 'home', 'property', 'perumahan', 'rumah'],
      employment: ['job', 'work', 'employment', 'kerja', 'pekerjaan'],
      social_welfare: ['welfare', 'assistance', 'support', 'bantuan', 'kebajikan']
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(keyword => lowerText.includes(keyword))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  /**
   * Extract keywords for search optimization
   */
  private extractKeywords(text: string): string[] {
    const keywords: string[] = [];
    
    // Extract important phrases (2-3 words)
    const phrases = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) || [];
    keywords.push(...phrases.slice(0, 10)); // Top 10 phrases

    // Extract government-specific terms
    const govTerms = text.match(/\b(?:ministry|kementerian|department|jabatan|policy|dasar|program|bantuan|assistance|application|permohonan)\b/gi) || [];
    keywords.push(...govTerms);

    // Remove duplicates and return
    return [...new Set(keywords.map(k => k.toLowerCase()))];
  }

  /**
   * Extract entities from text
   */
  private extractEntities(text: string): string[] {
    const entities: string[] = [];

    for (const [type, pattern] of Object.entries(ENTITY_PATTERNS)) {
      const matches = text.match(pattern) || [];
      entities.push(...matches.map(match => `${type}:${match}`));
    }

    return entities;
  }

  /**
   * Extract dates and classify them
   */
  private extractDates(text: string): {
    effective_date?: string;
    expiry_date?: string;
    last_updated?: string;
  } {
    const dates: any = {};
    const dateMatches = text.match(ENTITY_PATTERNS.dates) || [];

    for (const dateMatch of dateMatches) {
      const context = this.getDateContext(text, dateMatch);
      
      if (/effective|berkuat kuasa|mula/i.test(context)) {
        dates.effective_date = dateMatch;
      } else if (/expir|tamat|until|hingga/i.test(context)) {
        dates.expiry_date = dateMatch;
      } else if (/updated|dikemaskini|last/i.test(context)) {
        dates.last_updated = dateMatch;
      }
    }

    return dates;
  }

  /**
   * Get context around a date mention
   */
  private getDateContext(text: string, date: string): string {
    const index = text.indexOf(date);
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + date.length + 50);
    return text.substring(start, end);
  }

  /**
   * Detect ministry from text
   */
  private detectMinistry(text: string): string {
    for (const [ministry, pattern] of Object.entries(CLASSIFICATION_PATTERNS.ministries)) {
      if (pattern.test(text)) {
        return ministry;
      }
    }
    return 'Unknown Ministry';
  }

  /**
   * Extract department from source name
   */
  private extractDepartment(sourceName: string): string {
    // Extract department from source name
    const deptMatch = sourceName.match(/department|jabatan|unit|bahagian/i);
    if (deptMatch) {
      return sourceName;
    }
    return 'Unknown Department';
  }

  /**
   * Detect target audience
   */
  private detectTargetAudience(text: string): string[] {
    const audiences: string[] = [];
    
    for (const [audience, pattern] of Object.entries(CLASSIFICATION_PATTERNS.audiences)) {
      if (pattern.test(text)) {
        audiences.push(audience);
      }
    }

    return audiences.length > 0 ? audiences : ['Citizens'];
  }

  /**
   * Extract program name from text
   */
  private extractProgramName(text: string): string | undefined {
    // Look for program names in titles or headings
    const programPatterns = [
      /program\s+([A-Z][A-Za-z\s]+)/i,
      /bantuan\s+([A-Z][A-Za-z\s]+)/i,
      /scheme\s+([A-Z][A-Za-z\s]+)/i,
      /skim\s+([A-Z][A-Za-z\s]+)/i
    ];

    for (const pattern of programPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  /**
   * Calculate confidence score based on content quality
   */
  private calculateConfidenceScore(text: string): number {
    let score = 0.5; // Base score

    // Length score
    if (text.length > 100) score += 0.1;
    if (text.length > 500) score += 0.1;

    // Structure indicators
    if (/\d+\.|[A-Z]\.|•|\-/.test(text)) score += 0.1; // Has lists
    if (/eligib|require|apply|contact/i.test(text)) score += 0.1; // Has key info
    if (ENTITY_PATTERNS.dates.test(text)) score += 0.1; // Has dates

    // Government authenticity indicators
    if (/ministry|kementerian|government|kerajaan/i.test(text)) score += 0.1;

    return Math.min(1.0, score);
  }

  /**
   * Calculate completeness score
   */
  private calculateCompletenessScore(text: string): number {
    let score = 0;
    const maxScore = 6;

    // Check for essential information components
    if (/eligib|layak/i.test(text)) score++; // Eligibility info
    if (/apply|mohon/i.test(text)) score++; // Application info
    if (/require|perlu|dokumen/i.test(text)) score++; // Requirements
    if (/contact|hubungi/i.test(text)) score++; // Contact info
    if (ENTITY_PATTERNS.dates.test(text)) score++; // Dates
    if (/benefit|bantuan|faedah/i.test(text)) score++; // Benefits

    return score / maxScore;
  }
}

/**
 * Factory function for easy usage
 */
export function generateMetadata(
  chunk: SemanticChunk,
  structure: DocumentStructure,
  sourceUrl: string,
  sourceName: string,
  options?: Partial<MetadataGenerationOptions>
): EnhancedMetadata {
  const generator = new MetadataGenerator(options);
  return generator.generateForChunk(chunk, structure, sourceUrl, sourceName);
}