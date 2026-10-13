---
name: xiaohongshu-market-research
description: 抓取小红书关键词下的帖子、一级评论、二级评论，并基于抓取结果输出市场调研总结。只要用户提到“小红书”“XHS”“关键词调研”“帖子和评论抓取”“评论区分析”“市场调研总结”“竞品内容分析”“用户需求洞察”等场景，都应主动使用这个 skill，哪怕用户没有明确说“skill”。
metadata:
  short-description: 小红书帖子与评论抓取 + 市场调研总结
  openclaw:
    skillKey: xiaohongshu-market-research
    os:
      - linux
    requires:
      bins:
        - node
        - bash
      anyBins:
        - google-chrome
        - google-chrome-stable
        - chromium
        - chromium-browser
---

# 小红书市场调研 Skill

## 核心能力

1. 读取登录态
2. 抓取搜索结果、帖子详情、一级评论、二级评论
3. 输出结构化 JSON
4. 基于抓取结果生成调研总结
5. 按需生成 markdown 表格报告

## 登录态规则

优先级：

1. `XHS_BROWSER_URL` / `XHS_CDP_URL`
2. `XHS_USER_DATA_DIR` 或默认 `./.xhs_user_data`
3. `XHS_COOKIE` / `XHS_COOKIE_FILE`

重要约束：

- 不要把 browser 工具里已登录的页面直接当作本 skill 可复用登录态
- 只有同一个 `XHS_USER_DATA_DIR`，或明确可用的 `XHS_BROWSER_URL`，才能复用现成登录态

## 前置检查

先确认当前环境实际提供了哪种登录态：

```bash
printenv XHS_BROWSER_URL | head
printenv XHS_USER_DATA_DIR | head
printenv XHS_COOKIE | head
printenv XHS_COOKIE_FILE | head
```

## 登录辅助命令

1. 准备浏览器 profile：

```bash
npm run prepare:login
```

这个命令固定使用 `XHS_USER_DATA_DIR` 对应的浏览器 profile，不会回退到 `XHS_COOKIE`、`XHS_COOKIE_FILE`、`XHS_BROWSER_URL`。

2. 本地扫码并导出 cookie 文件：

```bash
npm run cookie:login -- --output ./cookie.txt
export XHS_COOKIE_FILE='./cookie.txt'
```

3. 通过 CDP 导出完整 cookie：

```bash
export XHS_BROWSER_URL='http://127.0.0.1:9222'
npm run cookie:from-cdp -- --output ./cookie.txt
export XHS_COOKIE_FILE='./cookie.txt'
```

## 关键文件

- `scripts/xhs_fetch.js`：抓取入口
- `scripts/xhs_bridge.js`：页面内 bridge，复用前端真实 API
- `scripts/xhs_session.js`：登录态选择与浏览器会话管理
- `scripts/export_xhs_cookie_from_cdp.js`：从 CDP 导出完整 cookie
- `scripts/capture_xhs_cookie_via_login.js`：本地扫码后导出 cookie
- `scripts/render_table_report.js`：JSON 转 markdown 表格

## 执行方式

抓取：

```bash
bash scripts/run_research.sh "<关键词>" [帖子数] [评论数] [二级评论数] [输出文件]
```

或：

```bash
npm run fetch:xhs -- --keyword "<关键词>" --notes 20 --comments 30 --sub-comments 20
```

表格模式：

```bash
node scripts/render_table_report.js <输出json> [输出md]
```

## 标准工作流

1. 确认登录态来源
2. 如无可用登录态，优先执行 `prepare:login`、`cookie:login` 或 `cookie:from-cdp`
3. 运行抓取
4. 根据用户需求返回 JSON、总结或表格报告

## 输出规则

### 用户只要抓取结果

返回：

- 输出文件路径
- 抓取规模
- 评论区抓取是否成功
- 当前登录态来源

### 用户要调研总结

返回：

- 输出文件路径
- markdown 调研报告
- 必要时附代表性评论

### 用户要表格模式

返回：

- JSON 输出文件路径
- markdown 表格文件路径
- 3 至 5 条结论

## 依赖文件

必要时查看：

- `README.md`
- `scripts/xhs_fetch.js`
- `scripts/xhs_bridge.js`
