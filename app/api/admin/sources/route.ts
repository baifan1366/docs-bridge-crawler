/**
 * Admin API to manage crawler sources
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Get all sources
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: sources, error } = await supabase
      .from('crawler_sources')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ sources });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// Create new source
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { name, base_url, sitemap_url, metadata } = body;

    if (!name || !base_url) {
      return NextResponse.json(
        { error: 'name and base_url are required' },
        { status: 400 }
      );
    }

    const { data: source, error } = await supabase
      .from('crawler_sources')
      .insert({
        name,
        base_url,
        sitemap_url,
        is_active: true,
        metadata: metadata || {}
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ source }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
