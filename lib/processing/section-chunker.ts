/**
 * Section-aware chunking for government documents
 */

import * as cheerio from 'cheerio';
import { encode } from 'gpt-tokenizer';

export interface SectionChunk {
  text: string;
  heading: string;
  level: number; // h1=1, h2=2, etc.
  tokenCount: number;
  sectionType?: 'eligibility' | 'benefits' | 'process' | 'requirements' | 'fees' | 'contact' | 'other';
}

export function chunkBySections(html: string): SectionChunk[] {
  const $ = cheerio.load(html);
  const chunks: SectionChunk[] = [];

  // Find all headings
  const headings = $('h1, h2, h3, h4, h5, h6');

  headings.each((i, elem) => {
    const $heading = $(elem);
    const headingText = $heading.text().trim();
    const level = parseInt(elem.tagName[1]); // h2 -> 2

    // Get all content until next heading of same or higher level
    const content: string[] = [headingText];
    let $next = $heading.next();

    while ($next.length > 0) {
      const nextTag = $next.prop('tagName')?.toLowerCase();
      
      // Stop if we hit another heading of same or higher level
      if (nextTag?.match(/^h[1-6]$/)) {
        const nextLevel = parseInt(nextTag[1]);
        if (nextLevel <= level) break;
      }

      content.push($next.text().trim());
      $next = $next.next();
    }

    const text = content.join('\n').trim();
    if (text.length < 50) return; // Skip very short sections

    chunks.push({
      text,
      heading: headingText,
      level,
      tokenCount: encode(text).length,
      sectionType: detectSectionType(headingText)
    });
  });

  return chunks;
}

function detectSectionType(heading: string): SectionChunk['sectionType'] {
  const lower = heading.toLowerCase();

  if (lower.includes('eligib') || lower.includes('kelayakan')) {
    return 'eligibility';
  }
  if (lower.includes('benefit') || lower.includes('manfaat') || lower.includes('faedah')) {
    return 'benefits';
  }
  if (lower.includes('process') || lower.includes('proses') || lower.includes('cara') || lower.includes('how to')) {
    return 'process';
  }
  if (lower.includes('require') || lower.includes('document') || lower.includes('dokumen')) {
    return 'requirements';
  }
  if (lower.includes('fee') || lower.includes('cost') || lower.includes('bayaran') || lower.includes('kos')) {
    return 'fees';
  }
  if (lower.includes('contact') || lower.includes('hubungi')) {
    return 'contact';
  }

  return 'other';
}

// Fallback: If no sections detected, use token-based chunking
export function fallbackChunking(text: string, maxTokens: number = 500): SectionChunk[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: SectionChunk[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const tokens = encode(sentence).length;

    if (currentTokens + tokens > maxTokens && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.join(' '),
        heading: 'Content',
        level: 0,
        tokenCount: currentTokens,
        sectionType: 'other'
      });
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(sentence.trim());
    currentTokens += tokens;
  }

  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.join(' '),
      heading: 'Content',
      level: 0,
      tokenCount: currentTokens,
      sectionType: 'other'
    });
  }

  return chunks;
}
