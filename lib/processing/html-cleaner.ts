/**
 * Advanced HTML cleaning for government websites
 * Implements industry-standard content extraction methods
 */

import * as cheerio from 'cheerio';

export interface CleaningResult {
  cleanText: string;
  title: string;
  language: string;
  metadata: {
    originalLength: number;
    cleanedLength: number;
    elementsRemoved: string[];
    contentScore: number;
    extractionMethod: 'readability' | 'boilerplate' | 'custom-selectors' | 'body-fallback';
  };
}

export interface CleaningOptions {
  removeNavigation: boolean;
  removeFooter: boolean;
  removeSidebar: boolean;
  removeAds: boolean;
  removeCookieBanners: boolean;
  preserveStructure: boolean;
  minContentLength: number;
}

const DEFAULT_OPTIONS: CleaningOptions = {
  removeNavigation: true,
  removeFooter: true,
  removeSidebar: true,
  removeAds: true,
  removeCookieBanners: true,
  preserveStructure: true,
  minContentLength: 100
};

/**
 * Government website specific selectors for content extraction
 */
const GOVERNMENT_CONTENT_SELECTORS = [
  // Common government content containers
  '.content',
  '.main-content',
  '.page-content',
  '.article-content',
  '.policy-content',
  '.document-content',
  
  // Malaysian government specific
  '.content-wrapper',
  '.main-wrapper',
  '.page-wrapper',
  
  // Generic content indicators
  'main',
  'article',
  '[role="main"]',
  '.container .row .col',
  
  // Fallback to body if nothing else found
  'body'
];

/**
 * Elements to remove (government website noise)
 */
const NOISE_SELECTORS = [
  // Navigation and menus
  'nav', 'header', 'footer',
  '.navigation', '.nav', '.menu',
  '.breadcrumb', '.breadcrumbs',
  
  // Sidebars and widgets
  '.sidebar', '.side-bar', '.widget',
  '.related-links', '.quick-links',
  
  // Ads and promotions
  '.ads', '.advertisement', '.promo',
  '.banner', '.promotion',
  
  // Cookie and privacy notices
  '.cookie-notice', '.cookie-banner',
  '.privacy-notice', '.gdpr-notice',
  
  // Social media and sharing
  '.social-share', '.share-buttons',
  '.social-media', '.follow-us',
  
  // Comments and feedback
  '.comments', '.feedback',
  '.rating', '.reviews',
  
  // Scripts and styles
  'script', 'style', 'noscript',
  
  // Hidden elements
  '[style*="display:none"]',
  '[style*="visibility:hidden"]',
  '.hidden', '.sr-only',
  
  // Government specific noise
  '.ministry-logo', '.gov-logo',
  '.contact-info', '.office-hours',
  '.last-updated', '.page-info'
];

/**
 * Advanced HTML cleaner with multiple extraction strategies
 */
export class HTMLCleaner {
  private options: CleaningOptions;

  constructor(options: Partial<CleaningOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Main cleaning method - tries multiple strategies
   */
  clean(html: string): CleaningResult {
    console.log('[HTML-CLEANER] Starting content extraction...');
    
    const originalLength = html.length;
    let bestResult: CleaningResult | null = null;
    let bestScore = 0;

    // Strategy 1: Readability-style extraction
    try {
      const readabilityResult = this.extractWithReadability(html);
      const score = this.scoreContent(readabilityResult.cleanText);
      
      if (score > bestScore) {
        bestScore = score;
        bestResult = {
          ...readabilityResult,
          metadata: {
            ...readabilityResult.metadata,
            contentScore: score,
            extractionMethod: 'readability'
          }
        };
      }
    } catch (error) {
      console.warn('[HTML-CLEANER] Readability extraction failed:', error);
    }

    // Strategy 2: Boilerplate removal
    try {
      const boilerplateResult = this.extractWithBoilerplateRemoval(html);
      const score = this.scoreContent(boilerplateResult.cleanText);
      
      if (score > bestScore) {
        bestScore = score;
        bestResult = {
          ...boilerplateResult,
          metadata: {
            ...boilerplateResult.metadata,
            contentScore: score,
            extractionMethod: 'boilerplate'
          }
        };
      }
    } catch (error) {
      console.warn('[HTML-CLEANER] Boilerplate removal failed:', error);
    }

    // Strategy 3: Custom selectors for government sites
    try {
      const customResult = this.extractWithCustomSelectors(html);
      const score = this.scoreContent(customResult.cleanText);
      
      if (score > bestScore) {
        bestScore = score;
        bestResult = {
          ...customResult,
          metadata: {
            ...customResult.metadata,
            contentScore: score,
            extractionMethod: 'custom-selectors'
          }
        };
      }
    } catch (error) {
      console.warn('[HTML-CLEANER] Custom selector extraction failed:', error);
    }

    if (!bestResult) {
      // Fallback: try one more time with just body content
      const $ = cheerio.load(html);
      const bodyText = this.cleanTextContent($('body').text());
      
      if (bodyText.length > 0) {
        console.log('[HTML-CLEANER] Using body content as final fallback');
        bestResult = {
          cleanText: bodyText,
          title: $('title').text() || $('h1').first().text() || '',
          language: $('html').attr('lang') || 'en',
          metadata: {
            originalLength: html.length,
            cleanedLength: bodyText.length,
            elementsRemoved: [],
            contentScore: 0,
            extractionMethod: 'body-fallback'
          }
        };
      } else {
        throw new Error('All content extraction strategies failed');
      }
    }

    console.log(`[HTML-CLEANER] Best extraction: ${bestResult.metadata.extractionMethod} (score: ${bestScore})`);
    console.log(`[HTML-CLEANER] Content length: ${originalLength} → ${bestResult.cleanText.length}`);

    return bestResult;
  }

  /**
   * Readability-style content extraction
   */
  private extractWithReadability(html: string): CleaningResult {
    const $ = cheerio.load(html);
    const elementsRemoved: string[] = [];

    // Remove noise elements
    NOISE_SELECTORS.forEach(selector => {
      const removed = $(selector);
      if (removed.length > 0) {
        elementsRemoved.push(`${selector} (${removed.length})`);
        removed.remove();
      }
    });

    // Find content containers and score them
    const contentCandidates: Array<{ element: cheerio.Cheerio<any>; score: number }> = [];

    $('div, article, section, main').each((_, element) => {
      const $element = $(element);
      const text = $element.text();
      const score = this.scoreElement($element, text);
      
      if (score > 0) {
        contentCandidates.push({ element: $element, score });
      }
    });

    // Sort by score and take the best
    contentCandidates.sort((a, b) => b.score - a.score);
    
    let cleanText = '';
    let title = $('title').text() || $('h1').first().text() || '';
    const language = $('html').attr('lang') || 'en';

    if (contentCandidates.length > 0) {
      const bestCandidate = contentCandidates[0];
      cleanText = this.cleanTextContent(bestCandidate.element.text());
    } else {
      // Fallback to body
      cleanText = this.cleanTextContent($('body').text());
    }

    return {
      cleanText,
      title: title.trim(),
      language,
      metadata: {
        originalLength: html.length,
        cleanedLength: cleanText.length,
        elementsRemoved,
        contentScore: 0, // Will be set by caller
        extractionMethod: 'readability'
      }
    };
  }

  /**
   * Boilerplate removal strategy
   */
  private extractWithBoilerplateRemoval(html: string): CleaningResult {
    const $ = cheerio.load(html);
    const elementsRemoved: string[] = [];

    // More aggressive removal of boilerplate content
    const boilerplateSelectors = [
      ...NOISE_SELECTORS,
      // Additional boilerplate patterns
      '.header', '.top-bar', '.utility-nav',
      '.footer', '.bottom-bar', '.site-info',
      '.skip-links', '.accessibility-links',
      '.search-form', '.site-search',
      '.language-selector', '.lang-switch',
      '.print-page', '.share-page',
      '.back-to-top', '.scroll-to-top'
    ];

    boilerplateSelectors.forEach(selector => {
      const removed = $(selector);
      if (removed.length > 0) {
        elementsRemoved.push(`${selector} (${removed.length})`);
        removed.remove();
      }
    });

    // Extract main content
    let cleanText = '';
    let title = $('title').text() || $('h1').first().text() || '';
    const language = $('html').attr('lang') || 'en';

    // Try government-specific content selectors
    for (const selector of GOVERNMENT_CONTENT_SELECTORS) {
      const $content = $(selector);
      if ($content.length > 0) {
        const text = $content.text();
        if (text.length > this.options.minContentLength) {
          cleanText = this.cleanTextContent(text);
          break;
        }
      }
    }

    return {
      cleanText,
      title: title.trim(),
      language,
      metadata: {
        originalLength: html.length,
        cleanedLength: cleanText.length,
        elementsRemoved,
        contentScore: 0,
        extractionMethod: 'boilerplate'
      }
    };
  }

  /**
   * Custom selectors for government websites
   */
  private extractWithCustomSelectors(html: string): CleaningResult {
    const $ = cheerio.load(html);
    const elementsRemoved: string[] = [];

    // Remove noise first
    NOISE_SELECTORS.forEach(selector => {
      const removed = $(selector);
      if (removed.length > 0) {
        elementsRemoved.push(`${selector} (${removed.length})`);
        removed.remove();
      }
    });

    // Government-specific content extraction
    let cleanText = '';
    let title = $('title').text() || $('h1').first().text() || '';
    const language = $('html').attr('lang') || 'ms'; // Default to Malay for Malaysian sites

    // Try specific selectors in order of preference
    const contentSelectors = [
      // High priority - specific content areas
      '.policy-content', '.document-content', '.article-content',
      '.main-content', '.content-wrapper', '.page-content',
      
      // Medium priority - semantic elements
      'main', 'article', '[role="main"]',
      
      // Lower priority - generic containers
      '.content', '.container .content', '.wrapper .content',
      
      // Fallback
      'body'
    ];

    for (const selector of contentSelectors) {
      const $element = $(selector);
      if ($element.length > 0) {
        const text = $element.text();
        if (text.length > this.options.minContentLength) {
          cleanText = this.cleanTextContent(text);
          console.log(`[HTML-CLEANER] Content extracted using selector: ${selector}`);
          break;
        }
      }
    }

    return {
      cleanText,
      title: title.trim(),
      language,
      metadata: {
        originalLength: html.length,
        cleanedLength: cleanText.length,
        elementsRemoved,
        contentScore: 0,
        extractionMethod: 'custom-selectors'
      }
    };
  }

  /**
   * Score an element for content quality
   */
  private scoreElement($element: cheerio.Cheerio<any>, text: string): number {
    let score = 0;

    // Length score
    score += Math.min(text.length / 100, 50);

    // Paragraph density
    const paragraphs = $element.find('p').length;
    score += paragraphs * 2;

    // Link density (lower is better for content)
    const links = $element.find('a').length;
    const linkDensity = links / Math.max(text.length / 100, 1);
    score -= linkDensity * 5;

    // Class and ID indicators
    const className = $element.attr('class') || '';
    const id = $element.attr('id') || '';
    
    // Positive indicators
    if (/content|article|main|body|post|entry/i.test(className + id)) {
      score += 10;
    }
    
    // Negative indicators
    if (/nav|menu|sidebar|footer|header|ad|comment|widget/i.test(className + id)) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  /**
   * Score content quality
   */
  private scoreContent(text: string): number {
    if (!text || text.length < this.options.minContentLength) {
      return 0;
    }

    let score = 0;

    // Length score
    score += Math.min(text.length / 100, 100);

    // Sentence structure
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    score += sentences.length * 2;

    // Word diversity
    const words = text.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    const diversity = uniqueWords.size / words.length;
    score += diversity * 50;

    // Government content indicators
    const govKeywords = [
      'policy', 'regulation', 'law', 'act', 'procedure',
      'application', 'eligibility', 'requirement', 'document',
      'ministry', 'department', 'government', 'public',
      'citizen', 'service', 'benefit', 'program'
    ];
    
    const govMatches = govKeywords.filter(keyword => 
      text.toLowerCase().includes(keyword)
    ).length;
    score += govMatches * 5;

    return score;
  }

  /**
   * Clean and normalize text content
   */
  private cleanTextContent(text: string): string {
    return text
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove excessive newlines
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      // Remove leading/trailing whitespace
      .trim()
      // Remove duplicate lines
      .split('\n')
      .filter((line, index, array) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        // Remove if same as previous line
        return index === 0 || trimmed !== array[index - 1]?.trim();
      })
      .join('\n')
      // Final cleanup
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/**
 * Factory function for easy usage
 */
export function cleanHTML(html: string, options?: Partial<CleaningOptions>): CleaningResult {
  const cleaner = new HTMLCleaner(options);
  return cleaner.clean(html);
}