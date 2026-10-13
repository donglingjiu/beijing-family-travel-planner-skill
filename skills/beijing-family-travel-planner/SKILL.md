---
name: beijing-family-travel-planner
description: 生成北京周末带娃亲子游性价比攻略。输入一句话诉求（如"周末带娃去哪""朝阳区附近好去处"），编排调用 baidu-search（本地宝/博客检索）、xiaohongshu-market-research（小红书检索）、tieba-search（贴吧检索）三个技能实时取数，再按固定判据做多源交叉核验反刷帖、五维性价比打分、区域过滤、门票类场所错峰建议，输出五段式攻略（需求确认/性价比对比表/mermaid路线图/错峰建议/数据来源说明）。只要用户提到"北京亲子游""带娃去哪""周末遛娃""XX区附近好去处""亲子游攻略"等场景，都应主动使用本 skill。
---

# 北京亲子游性价比攻略规划

## 这个 skill 做什么

单次调用即产出一份完整的北京周末带娃亲子游性价比攻略，效果与"北京亲子游攻略专家"agent 角色完全一致——因为本 skill 就是把该角色的判据原样搬进来，用脚本编排三个已就绪的检索技能取数，再由你（调用本 skill 的 AI）按判据完成交叉核验、打分、排版。

**重要边界**：交叉核验、打分、区域过滤、错峰建议、五段式排版这些推理步骤，本 skill 不会用脚本自动做——因为这些判断依赖对搜索结果文本内容的语义理解（比如判断一段话是不是软文、两条信息是否矛盾），必须由你读取判据后逐条应用，脚本只负责取数据。

## 使用流程

### 第一步：解析输入

从用户一句话诉求中提取：
- 区域限定（未提及默认全北京）
- 孩子年龄段（未提及默认 0-12 岁不限）

### 第二步：完整读取判据

**必须先完整读取 [references/judgment_criteria.md](references/judgment_criteria.md)**，这是本 skill 的核心权威判据原文（交叉核验规则、五维评分权重、区域过滤逻辑、错峰建议规则、五段式输出结构），后续每一步都要逐条对照执行，不得凭记忆简化。

### 第三步：确定候选场所并检索

基于候选池范围（全北京或指定区域），列出若干候选场所/话题关键词（公园、商场、景点、滑雪场等门票类场所不限于此清单），对每个候选场所执行检索：

```bash
python3 scripts/collect_sources.py '{"keyword": "朝阳公园 遛娃 攻略"}'
```

该脚本会依次调用三个已就绪技能并返回统一结构：

```json
{
  "keyword": "朝阳公园 遛娃 攻略",
  "sources": {
    "baidu_search": {"source": "baidu-search", "status": "ok|empty|unreachable", "reason": null, "items": [...]},
    "tieba_search": {"source": "tieba-search", "status": "ok|empty|unreachable", "reason": null, "items": [...]},
    "xiaohongshu_search": {"source": "xiaohongshu-market-research", "status": "ok|empty|unreachable", "reason": null, "items": [...]}
  }
}
```

三态含义：
- `ok`：成功取到内容，正常纳入交叉核验。
- `empty`：本次查询无结果，不代表不可达，可换关键词重试或视为该源无相关信息。
- `unreachable`：该源本次不可达（缺凭证/登录态、网络失败等），`reason` 会说明具体原因。**此时禁止编造该源内容，必须在最终"数据来源说明"段落中如实标注该源本次不可达，并说明用什么替代源补齐**（小红书/贴吧登录态或凭证缺失是常见情况）。

对每个候选场所重复调用，建议覆盖 5-10 个候选以便筛选出 3-8 个进入最终对比表。

### 第四步：应用判据完成推理

对每个候选场所，逐条应用 `references/judgment_criteria.md` 中的：
1. 交叉核验判据（多源验证阈值、新鲜度、反刷帖识别、冲突取舍、来源可追溯）
2. 五维性价比评分模型
3. 区域过滤逻辑
4. 门票类场所错峰建议

### 第五步：生成五段式输出

严格按 `references/judgment_criteria.md` 第七步的五段式结构输出：需求确认、性价比对比表（3-8个场所，8个固定字段）、mermaid 路线图、错峰建议汇总、数据来源说明。对比表和路线图为必需产出，不可省略。

## 硬性红线

见 `references/judgment_criteria.md` 末尾"硬性红线"章节，全程适用，不可删改。

## 依赖说明

- `baidu-search`、`tieba-search` 依赖环境变量 `BAIDU_API_KEY`（百度千帆 AI 搜索凭证）。
- `xiaohongshu-market-research` 依赖登录态环境变量之一：`XHS_COOKIE` / `XHS_COOKIE_FILE` / `XHS_BROWSER_URL` / `XHS_USER_DATA_DIR`。
- 以上凭证均在调用方运行环境中配置，本 skill 不内置任何凭证。缺失时 `collect_sources.py` 会如实返回该源 `unreachable`，不会中断整体流程。
