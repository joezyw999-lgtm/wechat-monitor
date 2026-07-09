import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'

// This route is called by Vercel Cron on a schedule
export async function GET() {
  try {
    const client = getSupabaseServiceClient() as any

    // Get API key from settings
    const { data: settingsData } = await client
      .from('settings')
      .select('value')
      .eq('key', 'api_key')
      .maybeSingle()

    const apiKey = settingsData?.value
    if (!apiKey) {
      return NextResponse.json({ success: false, message: 'API Key not configured' }, { status: 400 })
    }

    // Get active accounts
    const { data: accounts } = await client
      .from('accounts')
      .select('*')
      .eq('status', 'active')

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ success: true, message: 'No active accounts' })
    }

    // Get active keywords
    const { data: keywordsData } = await client
      .from('keywords')
      .select('keyword')
      .eq('status', 'active')
    const keywords = keywordsData?.map((k: any) => k.keyword) || []

    // Create crawl log
    const { data: logData } = await client
      .from('crawl_logs')
      .insert({
        trigger_type: 'cron',
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single()

    let totalNew = 0
    let totalMatched = 0
    let totalFailed = 0
    const errors: string[] = []

    for (const account of accounts) {
      const result = await fetchAccountArticles(apiKey, account.biz_id)
      
      if (!result.success) {
        totalFailed++
        errors.push(`${account.name}: ${result.error}`)
        continue
      }

      for (const article of result.articles) {
        const { data: existing } = await client
          .from('articles')
          .select('id')
          .eq('url', article.url)
          .maybeSingle()

        if (existing) continue

        const matchedKw = matchKeywords(article.title, article.digest || '', keywords)

        const { error: insertError } = await client
          .from('articles')
          .insert({
            account_id: account.id,
            title: article.title,
            url: article.url,
            summary: article.digest || null,
            cover_image: article.cover || null,
            author: article.author || account.name,
            content: article.content || null,
            published_at: new Date(article.publish_time * 1000).toISOString(),
            unique_key: article.msg_id || null,
            matched_keywords: matchedKw.length > 0 ? matchedKw : null
          })
        if (insertError) {
          errors.push(`Insert error: ${insertError.message}`)
          continue
        }

        totalNew++
        if (matchedKw.length > 0) totalMatched++
      }
    }

    // Update crawl log
    await client
      .from('crawl_logs')
      .update({
        status: totalFailed > 0 ? 'partial' : 'success',
        finished_at: new Date().toISOString(),
        accounts_crawled: accounts.length,
        articles_new: totalNew,
        articles_matched: totalMatched,
        error_message: errors.length > 0 ? errors.join('; ') : null
      })
      .eq('id', logData.id)

    return NextResponse.json({
      success: true,
      data: { accountsCrawled: accounts.length, newArticles: totalNew, matchedArticles: totalMatched }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
