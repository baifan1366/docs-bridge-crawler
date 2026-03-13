# Government Document Crawler Service

Smart crawler for government websites with section-aware chunking and intelligent extraction.

## Features

- ✅ Smart crawling with If-Modified-Since and ETag
- ✅ Section-aware chunking for government documents
- ✅ Rule-based extraction with LLM fallback
- ✅ QStash queue for reliable job processing
- ✅ Automatic embedding generation
- ✅ Rate limiting and robots.txt compliance

## Architecture

```
Vercel Cron → QStash Queue → Webhook → Processor → Supabase
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# QStash (get from https://console.upstash.com/qstash)
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=

# Worker webhook URL (your deployed URL)
WORKER_WEBHOOK_URL=https://your-app.vercel.app/api/webhook

# Cron secret (generate random string)
CRON_SECRET=

# Hugging Face API (for production)
HUGGINGFACE_API_KEY=
```

### 3. Database Setup

Run the migration in your Supabase project:

```bash
# Copy the migration file to your main project
cp supabase/migrations/20260313_create_crawler_tables.sql ../supabase/migrations/
```

### 4. Add Crawler Sources

Insert a source in Supabase:

```sql
INSERT INTO crawler_sources (name, base_url, sitemap_url, is_active, metadata)
VALUES (
  'Malaysia Government Portal',
  'https://www.malaysia.gov.my',
  'https://www.malaysia.gov.my/sitemap.xml',
  true,
  '{"trust_level": 1.0}'::jsonb
);
```

## Development

```bash
npm run dev
```

## Testing Locally

### Test Webhook

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "crawl",
    "url": "https://example.com/page",
    "sourceId": "your-source-id"
  }'
```

### Test Cron

```bash
curl http://localhost:3000/api/cron/check-updates \
  -H "Authorization: Bearer your_cron_secret"
```

## Deployment

### Deploy to Vercel

```bash
vercel --prod
```

### Set Environment Variables

In Vercel Dashboard, add all environment variables from `.env.example`.

### Configure QStash

1. Get your deployed webhook URL: `https://your-app.vercel.app/api/webhook`
2. Update `WORKER_WEBHOOK_URL` in Vercel environment variables
3. Redeploy

## Monitoring

View crawler stats:

```typescript
import { getCrawlerStats } from '@/lib/monitoring/metrics';

const stats = await getCrawlerStats(24); // Last 24 hours
console.log(stats);
```

## How It Works

1. **Cron Job** runs every hour
2. Checks sitemap for updated pages
3. Enqueues jobs to QStash with flow control
4. Webhook receives jobs and processes pages
5. Smart fetch checks If-Modified-Since/ETag
6. Content hash prevents duplicate processing
7. Section-aware chunking preserves structure
8. Rule-based extraction with LLM fallback
9. Embeddings generated and stored

## Cost Estimate

- Vercel: Free (Hobby)
- QStash: Free tier (500 msgs/day)
- Supabase: $25/month (Pro)
- Hugging Face API: ~$2/month

**Total: ~$27/month**
