import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 通过搜狗微信搜索查询公众号原始ID
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json({ success: false, message: '请提供公众号名称' });
    }

    // 通过搜狗微信搜索查询公众号
    const searchUrl = `https://weixin.sogou.com/weixin?type=1&query=${encodeURIComponent(name)}&ie=utf8`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ success: false, message: '搜狗搜索请求失败' });
    }

    const html = await response.text();

    // 从搜索结果中提取公众号信息
    // 搜狗搜索结果中，公众号页面的链接包含 __biz 参数
    const bizMatch = html.match(/__biz=([A-Za-z0-9=]+)/);
    
    // 尝试从页面中提取原始ID (gh_xxx格式)
    // 搜狗搜索结果的公众号卡片中会显示微信号
    const wxidMatch = html.match(/微信号：<\/label>([^<]+)/) || 
                      html.match(/wechat_id\s*[:=]\s*["']?([^"'}\s]+)/) ||
                      html.match(/gh_[a-f0-9]{12}/);

    // 尝试从 JavaScript 变量中提取 biz
    const bizVarMatch = html.match(/var\s+biz\s*=\s*["']([^"']+)["']/) ||
                        html.match(/"biz"\s*:\s*"([^"]+)"/);

    let bizId = '';
    if (bizVarMatch) {
      bizId = bizVarMatch[1];
    } else if (bizMatch) {
      bizId = bizMatch[1];
    }

    // 提取公众号名称
    const nameMatch = html.match(/<p class="tit"[^>]*>[^<]*<a[^>]*>([^<]+)<\/a>/) ||
                      html.match(/class="pub_name"[^>]*>([^<]+)/);
    const accountName = nameMatch ? nameMatch[1].trim() : '';

    // 提取头像
    const avatarMatch = html.match(/<img[^>]*class="[^"]*head_pic[^"]*"[^>]*src="([^"]+)"/) ||
                        html.match(/<div[^>]*class="img-box"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
    const avatar = avatarMatch ? avatarMatch[1] : '';

    // 提取简介
    const descMatch = html.match(/<p class="sp-txt">([^<]+)/) ||
                      html.match(/intro\s*[:=]\s*["']([^"']+)/);
    const description = descMatch ? descMatch[1].trim() : '';

    // 提取微信号 (不是原始ID，是自定义微信号)
    let wechatId = '';
    if (wxidMatch && wxidMatch[0].startsWith('gh_')) {
      wechatId = wxidMatch[0];
    } else if (wxidMatch) {
      wechatId = wxidMatch[1]?.trim() || '';
    }

    // 如果找到了 biz，尝试构造原始ID
    // 注意：biz 是 base64 编码的，原始ID 是 gh_ 开头的
    // 搜狗搜索可能直接显示原始ID
    const ghIdMatch = html.match(/gh_[a-f0-9]{12}/);
    const originalId = ghIdMatch ? ghIdMatch[0] : '';

    if (!bizId && !originalId && !wechatId) {
      return NextResponse.json({ 
        success: false, 
        message: '未找到该公众号，请确认名称是否正确' 
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        name: accountName || name,
        biz_id: bizId,
        original_id: originalId,
        wechat_id: wechatId,
        avatar,
        description,
      }
    });

  } catch (error) {
    console.error('查询公众号失败:', error);
    return NextResponse.json({ 
      success: false, 
      message: '查询失败，请稍后重试' 
    });
  }
}
