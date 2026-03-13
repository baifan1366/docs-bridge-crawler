#!/usr/bin/env node

/**
 * Test cron job locally
 * Usage: npm run test:cron
 */

const url = process.env.WORKER_WEBHOOK_URL 
  ? process.env.WORKER_WEBHOOK_URL.replace('/api/webhook', '/api/cron/check-updates')
  : 'http://localhost:3000/api/cron/check-updates';

const secret = process.env.CRON_SECRET || 'test-secret';

console.log('Testing cron job...');
console.log('URL:', url);

fetch(url, {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${secret}`
  }
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
