/**
 * OCR processing for images without alt text
 * Uses Tesseract.js for client-side OCR
 */

import { createWorker } from 'tesseract.js';

export interface OCRResult {
  text: string;
  confidence: number;
}

/**
 * Check if we should perform OCR on an image
 */
export function shouldPerformOCR(imgSrc: string, alt?: string): boolean {
  // Skip if already has meaningful alt text
  if (alt && alt.length > 10 && !alt.toLowerCase().includes('image')) {
    return false;
  }
  
  // Only process common image formats
  const src = imgSrc.toLowerCase();
  return src.includes('.jpg') || src.includes('.jpeg') || 
         src.includes('.png') || src.includes('.gif') ||
         src.includes('.webp') || src.includes('.bmp');
}

/**
 * Extract text from image using OCR
 */
export async function extractTextFromImage(imageUrl: string): Promise<OCRResult> {
  console.log(`[OCR] Processing image: ${imageUrl}`);
  
  try {
    const worker = await createWorker('eng+chi_sim+chi_tra+mal', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          console.log(`[OCR] Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    
    const { data: { text, confidence } } = await worker.recognize(imageUrl);
    await worker.terminate();
    
    // Clean up the extracted text
    const cleanText = text.trim().replace(/\s+/g, ' ');
    
    console.log(`[OCR] Extracted text (${confidence}% confidence): "${cleanText.substring(0, 100)}..."`);
    
    return {
      text: cleanText,
      confidence: confidence / 100 // Convert to 0-1 range
    };
    
  } catch (error) {
    console.error(`[OCR] Error processing image ${imageUrl}:`, error);
    return {
      text: '',
      confidence: 0
    };
  }
}

/**
 * Process all images in HTML and extract text via OCR
 */
export async function processImagesWithOCR(
  $: cheerio.CheerioAPI, 
  baseUrl: string
): Promise<{
  altTexts: string[];
  ocrTexts: string[];
  processedImages: number;
}> {
  const altTexts: string[] = [];
  const ocrTexts: string[] = [];
  let processedImages = 0;
  
  const images = $('img');
  console.log(`[OCR] Found ${images.length} images to process`);
  
  // Limit OCR processing to avoid timeout (max 3 images)
  const MAX_OCR_IMAGES = 3;
  let ocrCount = 0;
  
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const $img = $(img);
    const src = $img.attr('src');
    const alt = $img.attr('alt')?.trim();
    
    if (!src) continue;
    
    // Convert relative URLs to absolute
    let imageUrl: string;
    try {
      imageUrl = src.startsWith('http') ? src : new URL(src, baseUrl).toString();
    } catch (e) {
      console.error(`[OCR] Invalid image URL: ${src}`);
      $img.remove();
      continue;
    }
    
    if (alt && alt.length > 3) {
      // Has alt text
      altTexts.push(alt);
      $img.replaceWith(`[Image: ${alt}]`);
    } else if (shouldPerformOCR(imageUrl) && ocrCount < MAX_OCR_IMAGES) {
      // No alt text, try OCR
      try {
        console.log(`[OCR] Processing image ${ocrCount + 1}/${MAX_OCR_IMAGES}: ${imageUrl}`);
        const ocrResult = await extractTextFromImage(imageUrl);
        
        if (ocrResult.text && ocrResult.confidence > 0.6) {
          ocrTexts.push(ocrResult.text);
          $img.replaceWith(`[Image (OCR): ${ocrResult.text}]`);
        } else if (ocrResult.text && ocrResult.confidence > 0.3) {
          // Low confidence, but include with warning
          ocrTexts.push(`[Low confidence] ${ocrResult.text}`);
          $img.replaceWith(`[Image (OCR, low confidence): ${ocrResult.text}]`);
        } else {
          $img.replaceWith(`[Image: No readable text found]`);
        }
        
        processedImages++;
        ocrCount++;
      } catch (error) {
        console.error(`[OCR] Failed to process image ${imageUrl}:`, error);
        $img.replaceWith(`[Image: OCR processing failed]`);
      }
    } else {
      // Remove image without replacement or skip due to limit
      if (ocrCount >= MAX_OCR_IMAGES) {
        $img.replaceWith(`[Image: OCR limit reached]`);
      } else {
        $img.remove();
      }
    }
  }
  
  console.log(`[OCR] Processed ${processedImages} images with OCR, found ${altTexts.length} alt texts, ${ocrTexts.length} OCR texts`);
  
  return {
    altTexts,
    ocrTexts,
    processedImages
  };
}