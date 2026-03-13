/**
 * Rule-based extraction for government documents
 * More reliable than LLM for structured data
 */

import * as cheerio from 'cheerio';

export interface ExtractedData {
  program_name?: string;
  eligibility: string[];
  required_documents: string[];
  application_process: Array<{ step: number; description: string }>;
  benefits: string[];
  contact_info: {
    phone?: string;
    email?: string;
    address?: string;
    website?: string;
  };
  deadlines: Array<{ type: string; date?: string; description: string }>;
  fees: {
    amount?: string;
    currency?: string;
    description?: string;
  };
  extraction_method: 'rules' | 'llm';
  confidence: number;
}

export function extractWithRules(html: string, text: string): ExtractedData {
  const $ = cheerio.load(html);
  const result: ExtractedData = {
    eligibility: [],
    required_documents: [],
    application_process: [],
    benefits: [],
    contact_info: {},
    deadlines: [],
    fees: {},
    extraction_method: 'rules',
    confidence: 0
  };

  let rulesMatched = 0;

  // Extract program name
  const h1 = $('h1').first().text().trim();
  if (h1) {
    result.program_name = h1;
    rulesMatched++;
  }

  // Extract eligibility (look for lists under "Eligibility" heading)
  const eligibilitySection = findSectionByHeading($, ['eligibility', 'kelayakan', 'syarat']);
  if (eligibilitySection) {
    result.eligibility = extractListItems($, eligibilitySection);
    rulesMatched++;
  }

  // Extract required documents
  const docsSection = findSectionByHeading($, ['document', 'dokumen', 'required']);
  if (docsSection) {
    result.required_documents = extractListItems($, docsSection);
    rulesMatched++;
  }

  // Extract benefits
  const benefitsSection = findSectionByHeading($, ['benefit', 'manfaat', 'faedah']);
  if (benefitsSection) {
    result.benefits = extractListItems($, benefitsSection);
    rulesMatched++;
  }

  // Extract contact info with regex
  const phoneRegex = /(\+?6?0?1[0-9]{1,2}[-\s]?[0-9]{7,8})|(\+?60[0-9]{1,2}[-\s]?[0-9]{7,8})/g;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  
  const phones = text.match(phoneRegex);
  const emails = text.match(emailRegex);
  
  if (phones) {
    result.contact_info.phone = phones[0];
    rulesMatched++;
  }
  if (emails) {
    result.contact_info.email = emails[0];
    rulesMatched++;
  }

  // Extract fees
  const feeRegex = /(RM|MYR)\s*([0-9,]+(\.[0-9]{2})?)/gi;
  const fees = text.match(feeRegex);
  if (fees) {
    result.fees = {
      amount: fees[0],
      currency: 'MYR',
      description: extractFeeContext(text, fees[0])
    };
    rulesMatched++;
  }

  // Calculate confidence based on rules matched
  result.confidence = Math.min(rulesMatched / 7, 1.0);

  return result;
}

function findSectionByHeading($: cheerio.CheerioAPI, keywords: string[]): cheerio.Cheerio | null {
  const headings = $('h1, h2, h3, h4, h5, h6');
  
  for (let i = 0; i < headings.length; i++) {
    const heading = $(headings[i]);
    const text = heading.text().toLowerCase();
    
    if (keywords.some(kw => text.includes(kw))) {
      return heading.nextUntil('h1, h2, h3, h4, h5, h6');
    }
  }
  
  return null;
}

function extractListItems($: cheerio.CheerioAPI, section: cheerio.Cheerio): string[] {
  const items: string[] = [];
  
  section.find('li').each((i, elem) => {
    const text = $(elem).text().trim();
    if (text) items.push(text);
  });

  // If no list items, try paragraphs
  if (items.length === 0) {
    section.find('p').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text) items.push(text);
    });
  }

  return items;
}

function extractFeeContext(text: string, feeMatch: string): string {
  const index = text.indexOf(feeMatch);
  const start = Math.max(0, index - 100);
  const end = Math.min(text.length, index + 100);
  return text.substring(start, end).trim();
}
