/**
 * Document structure extraction for government documents
 * Parses hierarchical content structure (titles, sections, subsections)
 */

import * as cheerio from 'cheerio';

export interface DocumentSection {
  id: string;
  title: string;
  level: number;
  content: string;
  subsections: DocumentSection[];
  metadata: {
    position: number;
    wordCount: number;
    hasLists: boolean;
    hasTables: boolean;
    bulletPoints: string[];
  };
}

export interface DocumentStructure {
  title: string;
  language: string;
  sections: DocumentSection[];
  metadata: {
    totalSections: number;
    maxDepth: number;
    wordCount: number;
    structureType: 'hierarchical' | 'flat' | 'mixed';
    extractionMethod: 'html-headings' | 'text-patterns' | 'hybrid';
  };
}

/**
 * Government document structure patterns
 */
const SECTION_PATTERNS = {
  // Malaysian government patterns
  title: /^(TITLE|TAJUK|BAHAGIAN|SECTION)\s*:?\s*(.+)/i,
  section: /^(\d+\.?\s*|[A-Z]\.?\s*|SECTION\s+\d+|BAHAGIAN\s+\d+)\s*(.+)/i,
  subsection: /^(\d+\.\d+\.?\s*|[a-z]\)?\s*|\([a-z]\)\s*)\s*(.+)/i,
  bulletPoint: /^(\*|\-|\•|[a-z]\)|\([a-z]\)|\d+\))\s*(.+)/i,
  
  // English patterns
  eligibility: /^(ELIGIBILITY|KELAYAKAN|WHO CAN APPLY|SYARAT)/i,
  requirements: /^(REQUIREMENTS|KEPERLUAN|DOCUMENTS REQUIRED|DOKUMEN)/i,
  process: /^(PROCESS|PROSES|HOW TO APPLY|CARA MEMOHON)/i,
  benefits: /^(BENEFITS|FAEDAH|WHAT YOU GET|MANFAAT)/i,
  contact: /^(CONTACT|HUBUNGI|ENQUIRY|PERTANYAAN)/i
};

export class StructureParser {
  /**
   * Parse document structure from HTML
   */
  parseFromHTML(html: string, cleanText: string): DocumentStructure {
    console.log('[STRUCTURE-PARSER] Parsing HTML structure...');
    
    const $ = cheerio.load(html);
    const title = $('title').text() || $('h1').first().text() || 'Untitled Document';
    const language = $('html').attr('lang') || this.detectLanguage(cleanText);

    // Try HTML heading-based parsing first
    const htmlSections = this.extractFromHeadings($);
    
    if (htmlSections.length > 0) {
      console.log(`[STRUCTURE-PARSER] Extracted ${htmlSections.length} sections from HTML headings`);
      return {
        title,
        language,
        sections: htmlSections,
        metadata: {
          totalSections: this.countTotalSections(htmlSections),
          maxDepth: this.calculateMaxDepth(htmlSections),
          wordCount: this.calculateWordCount(htmlSections),
          structureType: this.determineStructureType(htmlSections),
          extractionMethod: 'html-headings'
        }
      };
    }

    // Fallback to text pattern parsing
    console.log('[STRUCTURE-PARSER] Falling back to text pattern parsing...');
    const textSections = this.extractFromTextPatterns(cleanText);
    
    return {
      title,
      language,
      sections: textSections,
      metadata: {
        totalSections: this.countTotalSections(textSections),
        maxDepth: this.calculateMaxDepth(textSections),
        wordCount: this.calculateWordCount(textSections),
        structureType: this.determineStructureType(textSections),
        extractionMethod: textSections.length > 0 ? 'text-patterns' : 'hybrid'
      }
    };
  }

  /**
   * Extract sections from HTML headings (h1-h6)
   */
  private extractFromHeadings($: cheerio.CheerioAPI): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const headings = $('h1, h2, h3, h4, h5, h6').toArray();
    
    let sectionCounter = 0;
    
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const $heading = $(heading);
      const level = parseInt(heading.tagName.substring(1)); // h1 -> 1, h2 -> 2, etc.
      const title = $heading.text().trim();
      
      if (!title) continue;

      // Get content until next heading of same or higher level
      const content = this.extractSectionContent($, heading, level);
      const bulletPoints = this.extractBulletPoints(content);
      
      const section: DocumentSection = {
        id: `section-${++sectionCounter}`,
        title,
        level,
        content: content.trim(),
        subsections: [],
        metadata: {
          position: i,
          wordCount: content.split(/\s+/).length,
          hasLists: bulletPoints.length > 0,
          hasTables: content.includes('|') || /<table/i.test(content),
          bulletPoints
        }
      };

      // Handle nesting
      if (level === 1 || sections.length === 0) {
        sections.push(section);
      } else {
        // Find parent section
        const parent = this.findParentSection(sections, level);
        if (parent) {
          parent.subsections.push(section);
        } else {
          sections.push(section);
        }
      }
    }

    return sections;
  }

  /**
   * Extract sections from text patterns
   */
  private extractFromTextPatterns(text: string): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    let currentSection: DocumentSection | null = null;
    let sectionCounter = 0;
    let contentBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if line matches section patterns
      const sectionMatch = this.matchSectionPattern(line);
      
      if (sectionMatch) {
        // Save previous section
        if (currentSection && contentBuffer.length > 0) {
          currentSection.content = contentBuffer.join('\n').trim();
          currentSection.metadata.wordCount = currentSection.content.split(/\s+/).length;
          currentSection.metadata.bulletPoints = this.extractBulletPoints(currentSection.content);
        }

        // Create new section
        currentSection = {
          id: `section-${++sectionCounter}`,
          title: sectionMatch.title,
          level: sectionMatch.level,
          content: '',
          subsections: [],
          metadata: {
            position: i,
            wordCount: 0,
            hasLists: false,
            hasTables: false,
            bulletPoints: []
          }
        };

        // Handle nesting
        if (sectionMatch.level === 1 || sections.length === 0) {
          sections.push(currentSection);
        } else {
          const parent = this.findParentSection(sections, sectionMatch.level);
          if (parent) {
            parent.subsections.push(currentSection);
          } else {
            sections.push(currentSection);
          }
        }

        contentBuffer = [];
      } else {
        // Add to content buffer
        contentBuffer.push(line);
      }
    }

    // Handle last section
    if (currentSection && contentBuffer.length > 0) {
      currentSection.content = contentBuffer.join('\n').trim();
      currentSection.metadata.wordCount = currentSection.content.split(/\s+/).length;
      currentSection.metadata.bulletPoints = this.extractBulletPoints(currentSection.content);
    }

    return sections;
  }

  /**
   * Extract content for a section until next heading
   */
  private extractSectionContent($: cheerio.CheerioAPI, headingElement: any, level: number): string {
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
   * Match line against section patterns
   */
  private matchSectionPattern(line: string): { title: string; level: number } | null {
    // Title pattern
    const titleMatch = line.match(SECTION_PATTERNS.title);
    if (titleMatch) {
      return { title: titleMatch[2].trim(), level: 1 };
    }

    // Section pattern
    const sectionMatch = line.match(SECTION_PATTERNS.section);
    if (sectionMatch) {
      return { title: sectionMatch[2].trim(), level: 2 };
    }

    // Subsection pattern
    const subsectionMatch = line.match(SECTION_PATTERNS.subsection);
    if (subsectionMatch) {
      return { title: subsectionMatch[2].trim(), level: 3 };
    }

    // Special government section patterns
    for (const [key, pattern] of Object.entries(SECTION_PATTERNS)) {
      if (key !== 'title' && key !== 'section' && key !== 'subsection' && key !== 'bulletPoint') {
        if (pattern.test(line)) {
          return { title: line.trim(), level: 2 };
        }
      }
    }

    return null;
  }

  /**
   * Extract bullet points from content
   */
  private extractBulletPoints(content: string): string[] {
    const bulletPoints: string[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const match = line.match(SECTION_PATTERNS.bulletPoint);
      if (match) {
        bulletPoints.push(match[2].trim());
      }
    }
    
    return bulletPoints;
  }

  /**
   * Find parent section for nesting
   */
  private findParentSection(sections: DocumentSection[], level: number): DocumentSection | null {
    // Find the most recent section with level < current level
    for (let i = sections.length - 1; i >= 0; i--) {
      const section = sections[i];
      if (section.level < level) {
        return section;
      }
      
      // Check subsections recursively
      const parent = this.findParentInSubsections(section.subsections, level);
      if (parent) {
        return parent;
      }
    }
    
    return null;
  }

  /**
   * Find parent in subsections recursively
   */
  private findParentInSubsections(subsections: DocumentSection[], level: number): DocumentSection | null {
    for (let i = subsections.length - 1; i >= 0; i--) {
      const section = subsections[i];
      if (section.level < level) {
        return section;
      }
      
      const parent = this.findParentInSubsections(section.subsections, level);
      if (parent) {
        return parent;
      }
    }
    
    return null;
  }

  /**
   * Count total sections including subsections
   */
  private countTotalSections(sections: DocumentSection[]): number {
    let count = sections.length;
    for (const section of sections) {
      count += this.countTotalSections(section.subsections);
    }
    return count;
  }

  /**
   * Calculate maximum depth
   */
  private calculateMaxDepth(sections: DocumentSection[]): number {
    let maxDepth = 0;
    for (const section of sections) {
      const depth = 1 + this.calculateMaxDepth(section.subsections);
      maxDepth = Math.max(maxDepth, depth);
    }
    return maxDepth;
  }

  /**
   * Calculate total word count
   */
  private calculateWordCount(sections: DocumentSection[]): number {
    let count = 0;
    for (const section of sections) {
      count += section.metadata.wordCount;
      count += this.calculateWordCount(section.subsections);
    }
    return count;
  }

  /**
   * Determine structure type
   */
  private determineStructureType(sections: DocumentSection[]): 'hierarchical' | 'flat' | 'mixed' {
    const hasSubsections = sections.some(s => s.subsections.length > 0);
    const maxDepth = this.calculateMaxDepth(sections);
    
    if (maxDepth <= 1) return 'flat';
    if (maxDepth >= 3) return 'hierarchical';
    return 'mixed';
  }

  /**
   * Detect language from content
   */
  private detectLanguage(text: string): string {
    const malayWords = ['dan', 'atau', 'untuk', 'dengan', 'pada', 'adalah', 'yang', 'ini', 'itu', 'akan'];
    const englishWords = ['and', 'or', 'for', 'with', 'on', 'is', 'the', 'this', 'that', 'will'];
    
    const lowerText = text.toLowerCase();
    const malayCount = malayWords.filter(word => lowerText.includes(word)).length;
    const englishCount = englishWords.filter(word => lowerText.includes(word)).length;
    
    return malayCount > englishCount ? 'ms' : 'en';
  }
}

/**
 * Factory function
 */
export function parseDocumentStructure(html: string, cleanText: string): DocumentStructure {
  const parser = new StructureParser();
  return parser.parseFromHTML(html, cleanText);
}