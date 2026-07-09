import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 通过 getoneapi.com 搜索接口查询公众号信息
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json({ success: false, message: '请提供公众号名称' });
    }

    // 从数据库获取 OneAPI Key
    const supabase = getSupabaseServiceClient();
    const { data: setting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'oneapi_key')
      .single();

    const apiKey = setting?.value;
    if (!apiKey) {
      return NextResponse.json({ 
        success: false, 
        message: '请先在系统设置中配置 OneAPI Key' 
      });
    }

    // 使用 getoneapi.com 的微信综合搜索接口（搜一搜）
    const searchResponse = await fetch('https://api.getoneapi.com/api/wechat-search/v2/account_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ 
        keyword: name,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!searchResponse.ok) {
      return NextResponse.json({ 
        success: false, 
        message: `搜索接口请求失败 (${searchResponse.status})` 
      });
    }

    const searchData = await searchResponse.json();

    if (searchData.code !== 200 || !searchData.data) {
      return NextResponse.json({ 
        success: false, 
        message: searchData.message || '搜索未找到结果' 
      });
    }

    // 从搜索结果中匹配公众号
    const results = Array.isArray(searchData.data) ? searchData.data : [searchData.data];
    
    // 查找最匹配的结果
    let matched = results.find((r: any) => 
      r.nickname === name || 
      r.name === name ||
      r.title === name
    ) || results[0];

    if (!matched) {
      return NextResponse.json({ 
        success: false, 
        message: '未找到该公众号，请确认名称是否正确' 
      });
    }

    // 提取公众号信息
    const bizId = matched.fakeid || matched.biz || matched.biz_id || '';
    const originalId = matched.original_id || matched.gh_id || '';
    const wechatId = matched.weixin_id || matched.wx_id || matched.alias || '';
    const avatar = matched.headimg || matched.avatar || matched.logo || '';
    const description = matched.signature || matched.description || matched.intro || '';
    const accountName = matched.nickname || matched.name || matched.title || name;

    if (!bizId && !originalId) {
      return NextResponse.json({ 
        success: false, 
        message: '找到了公众号但无法获取ID，请尝试手动填写' 
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        name: accountName,
        biz_id: bizId,
        original_id: originalId,
        wechat_id: wechatId,
        avatar,
        description,
      },
    });
  } catch (error: any) {
    console.error('公众号查询失败:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || '查询失败，请稍后重试' 
    });
  }
}
