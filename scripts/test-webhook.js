#!/usr/bin/env node

/**
 * Test webhook locally
 * Usage: npm run test:webhook
 */

const url = process.env.WORKER_WEBHOOK_URL || 'http://localhost:3000/api/webhook';
const sourceId = process.argv[2] || 'test-source-id';
const testUrl = process.argv[3] || 'https://www.malaysia.gov.my/portal/content/123';

console.log('Testing webhook...');
console.log('URL:', url);
console.log('Source ID:', sourceId);
console.log('Test URL:', testUrl);

fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    type: 'crawl',
    url: testUrl,
    sourceId: sourceId,
    timestamp: new Date().toISOString()
  })
})
  .then(res => res.json())
  .then(data => {
    console.log('\nResponse:');
    console.log(JSON.stringify(data, null, 2));
  })
  .catch(err => {
    console.error('\nError:');
    console.error(err.message);
  });
