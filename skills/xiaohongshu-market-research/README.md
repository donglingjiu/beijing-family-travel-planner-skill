# xiaohongshu-market-research

按关键词抓取小红书帖子、详情、一级评论、二级评论，输出 JSON，并可生成 markdown 表格报告。

## 目录

```text
xiaohongshu-market-research/
├── SKILL.md
├── README.md
├── package.json
├── openclaw.example.json
├── .env.example
└── scripts/
    ├── xhs_fetch.js
    ├── xhs_bridge.js
    ├── xhs_session.js
    ├── render_table_report.js
    ├── run_research.sh
    ├── export_xhs_cookie_from_cdp.js
    └── capture_xhs_cookie_via_login.js
```

## 环境要求

- Node.js 20+
- Chrome / Chromium
- 一种可用登录态

支持的浏览器路径：

- `/usr/bin/google-chrome`
- `/usr/bin/google-chrome-stable`
- `/usr/bin/chromium`
- `/usr/bin/chromium-browser`
- `/snap/bin/chromium`
- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

如有需要可设置：

```bash
export XHS_CHROME_PATH='/path/to/chrome'
```

## 登录态来源

脚本按以下顺序选择登录态：

1. `XHS_BROWSER_URL` / `XHS_CDP_URL`
2. `XHS_USER_DATA_DIR` 或默认 `./.xhs_user_data`
3. `XHS_COOKIE` / `XHS_COOKIE_FILE`

注意：

- OpenClaw browser 工具里的登录态不会自动共享给本 skill
- 只有同一个 `XHS_USER_DATA_DIR`，或明确可用的 `XHS_BROWSER_URL`，才可以复用现成登录态

## 登录辅助命令

1. 准备浏览器 profile：

```bash
npm run prepare:login
```

这个命令固定使用 `XHS_USER_DATA_DIR` 对应的浏览器 profile，不会回退到 `XHS_COOKIE`、`XHS_COOKIE_FILE`、`XHS_BROWSER_URL`。

2. 本地扫码后直接导出 cookie 文件：

```bash
npm run cookie:login -- --output ./cookie.txt
export XHS_COOKIE_FILE='./cookie.txt'
```

3. 从已运行浏览器的 CDP 导出完整 cookie：

```bash
export XHS_BROWSER_URL='http://127.0.0.1:9222'
npm run cookie:from-cdp -- --output ./cookie.txt
export XHS_COOKIE_FILE='./cookie.txt'
```

## 安装

```bash
pnpm install
```

或：

```bash
npm install
```

## 抓取

```bash
bash scripts/run_research.sh "咖啡" 5 20 10
```

或：

```bash
npm run fetch:xhs -- --keyword "咖啡" --notes 5 --comments 20 --sub-comments 10
```

## 表格报告

```bash
node scripts/render_table_report.js output_咖啡.json
```

## 输出

默认输出文件：

```text
output_<关键词>.json
```

抓取结果包含：

- 帖子基础信息
- 标题、正文、作者
- 原始发布时间与标准化日期
- 点赞、评论、收藏、分享等指标
- 一级评论与二级评论

## OpenClaw 配置

基础示例见 [openclaw.example.json](/Users/zhaochanghua/.codex/skills/xiaohongshu-market-research/openclaw.example.json:1)。

使用 CDP 时，建议单独增加：

```json
{
  "skills": {
    "entries": {
      "xiaohongshu-market-research": {
        "env": {
          "XHS_BROWSER_URL": "http://127.0.0.1:9222"
        }
      }
    }
  }
}
```
