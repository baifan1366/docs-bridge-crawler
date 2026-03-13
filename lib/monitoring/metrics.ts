/**
 * Monitoring and metrics logging
 */

import { createClient } from '../supabase/server';

export async function logCrawlMetrics(metrics: {
  url: string;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  chunks_created: number;
  extraction_method: 'rules' | 'llm';
  extraction_confidence: number;
}) {
  const supabase = await createClient();
  
  await supabase.from('crawler_metrics').insert({
    ...metrics,
    timestamp: new Date().toISOString()
  });

  // Alert if failure rate > 20%
  const failureRate = await getRecentFailureRate();
  if (failureRate > 0.2) {
    await sendAlert(`High failure rate: ${(failureRate * 100).toFixed(1)}%`);
  }
}

async function getRecentFailureRate(): Promise<number> {
  const supabase = await createClient();
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  
  const { data } = await supabase
    .from('crawler_metrics')
    .select('status')
    .gte('timestamp', oneHourAgo);

  if (!data || data.length === 0) return 0;

  const total = data.length;
  const failed = data.filter(m => m.status === 'failed').length;
  
  return failed / total;
}

async function sendAlert(message: string) {
  console.error(`⚠️ ALERT: ${message}`);
  // TODO: Integrate with Slack/Discord/Email
}

export async function getCrawlerStats(hours: number = 24) {
  const supabase = await createClient();
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  
  const { data } = await supabase
    .from('crawler_metrics')
    .select('*')
    .gte('timestamp', since);

  if (!data) return null;

  const total = data.length;
  const success = data.filter(m => m.status === 'success').length;
  const failed = data.filter(m => m.status === 'failed').length;
  const skipped = data.filter(m => m.status === 'skipped').length;

  const avgDuration = data.reduce((sum, m) => sum + (m.duration_ms || 0), 0) / total;
  const totalChunks = data.reduce((sum, m) => sum + (m.chunks_created || 0), 0);

  return {
    total,
    success,
    failed,
    skipped,
    success_rate: (success / total * 100).toFixed(1) + '%',
    failure_rate: (failed / total * 100).toFixed(1) + '%',
    avg_duration_ms: Math.round(avgDuration),
    total_chunks: totalChunks,
    period_hours: hours
  };
}
