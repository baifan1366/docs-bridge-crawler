/**
 * Anti-blocking crawler with rate limiting and robots.txt compliance
 */

import PQueue from 'p-queue';

export class AntiBlockCrawler {
  private queue: PQueue;
  private robotsCache: Map<string, any> = new Map();

  constructor() {
    // 1 request per second
    this.queue = new PQueue({
      concurrency: 1,
      interval: 1000,
      intervalCap: 1
    });
  }

  async canCrawl(url: string): Promise<boolean> {
    const urlObj = new URL(url);
    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;

    if (!this.robotsCache.has(robotsUrl)) {
      try {
        const response = await fetch(robotsUrl);
        const robotsTxt = await response.text();
        
        // Simple robots.txt parser
        const rules = this.parseRobotsTxt(robotsTxt);
        this.robotsCache.set(robotsUrl, rules);
      } catch {
        // If robots.txt doesn't exist, allow crawling
        return true;
      }
    }

    const rules = this.robotsCache.get(robotsUrl);
    return this.isAllowed(url, rules);
  }

  private parseRobotsTxt(robotsTxt: string): any {
    const lines = robotsTxt.split('\n');
    const rules: any = { disallow: [], allow: [] };
    
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith('disallow:')) {
        const path = trimmed.substring(9).trim();
        if (path) rules.disallow.push(path);
      } else if (trimmed.startsWith('allow:')) {
        const path = trimmed.substring(6).trim();
        if (path) rules.allow.push(path);
      }
    }
    
    return rules;
  }

  private isAllowed(url: string, rules: any): boolean {
    if (!rules) return true;
    
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    
    // Check disallow rules
    for (const disallowPath of rules.disallow) {
      if (path.startsWith(disallowPath)) {
        // Check if there's an allow rule that overrides
        for (const allowPath of rules.allow) {
          if (path.startsWith(allowPath)) {
            return true;
          }
        }
        return false;
      }
    }
    
    return true;
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // Check robots.txt
    const allowed = await this.canCrawl(url);
    if (!allowed) {
      throw new Error(`Blocked by robots.txt: ${url}`);
    }

    // Add to rate-limited queue
    return this.queue.add(() => fetch(url, options)) as Promise<Response>;
  }
}
