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
      .select('key, value')
      .in('key', ['api_key', 'oneapi_key', 'article_count'])

    const settingsMap: Record<string, string> = {}
    settingsData?.forEach((s: any) => {
      settingsMap[s.key] = s.value
    })

    const apiKey = settingsMap['oneapi_key'] || settingsMap['api_key']
    if (!apiKey) {
      return NextResponse.json({ success: false, message: 'API Key not configured' }, { status: 400 })
    }

    const articleCount = parseInt(settingsMap['article_count'] || '20', 10)

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
      .select('word')
      .eq('status', 'active')
    const keywords = keywordsData?.map((k: any) => k.word) || []

    // Create crawl log
    const { data: logData } = await client
      .from('crawl_logs')
      .insert({ status: 'running', message: 'Cron job started' })
      .select()
      .single()

    let totalFound = 0
    let totalNew = 0
    let totalMatched = 0
    let totalFailed = 0
    const errors: string[] = []

    for (const account of accounts) {
      const result = await fetchAccountArticles(apiKey, account.wx_id, articleCount)

      if (!result.success) {
        totalFailed++
        errors.push(`${account.name}: ${result.error}`)
        continue
      }

      // Log how many articles were returned from API
      console.log(`[Crawl] Account ${account.name} (${account.wx_id}): API returned ${result.articles.length} articles`)
      totalFound += result.articles.length

      for (const article of result.articles) {
        // Check for duplicates by original_url
        const { data: existing } = await client
          .from('articles')
          .select('id')
          .eq('original_url', article.url)
          .maybeSingle()

        if (existing) {
          console.log(`[Crawl] Skipping duplicate: ${article.title}`)
          continue
        }

        const matchedKw = matchKeywords(article.title, article.digest || '', keywords)

        // Insert article - use original_url instead of url
        await client.from('articles').insert({
          account_id: account.id,
          title: article.title,
          summary: article.digest || '',
          original_url: article.url,
          published_at: article.published_at || new Date().toISOString(),
          unique_key: article.msg_id || null,
          matched_keywords: matchedKw.length > 0 ? matchedKw : null,
        })

        totalNew++
        if (matchedKw.length > 0) totalMatched++
      }
    }

    await client
      .from('crawl_logs')
      .update({
        status: totalFailed > 0 ? 'partial' : 'success',
        message: errors.length > 0 ? errors.join('; ') : 'Success',
        articles_found: totalFound,
        articles_new: totalNew,
        articles_matched: totalMatched,
        finished_at: new Date().toISOString(),
      })
      .eq('id', logData.id)

    return NextResponse.json({ success: true, totalFound, totalNew, totalMatched, totalFailed })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
