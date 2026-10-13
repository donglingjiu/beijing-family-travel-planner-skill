import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_OUTPUT_SUFFIX = '.table.md';
const EMPTY_VALUE = '-';
const TOP_RANK_LIMIT = 10;
const FRESHNESS_WINDOW_DAYS = 30;
const SCORE_PRECISION = 1;
const WEIGHTS = Object.freeze({
  relevance: 25,
  engagement: 30,
  discussion: 20,
  freshness: 10,
  insight: 15,
});
const ENGAGEMENT_WEIGHTS = Object.freeze({
  like: 0.35,
  comment: 0.3,
  collect: 0.2,
  share: 0.15,
});
const SIGNAL_PATTERNS = Object.freeze({
  need: /想要|求推荐|有没有|求助|适合|推荐|怎么买|哪里买|值得|需要/gu,
  pain: /避雷|踩雷|翻车|不好用|难喝|鸡肋|失望|麻烦|问题|缺点|劝退/gu,
  compare: /对比|比较|平替|替代|区别|哪个|更好|pk/gu,
  emotion: /喜欢|真香|种草|爱了|无语|生气|后悔|满意|惊喜|崩溃/gu,
  question: /[?？]/gu,
});
function parseArgs(argv) {
  const input = argv[2];
  const output = argv[3] || input?.replace(/\.json$/i, DEFAULT_OUTPUT_SUFFIX);
  if (!input) throw new Error('用法: node scripts/render_table_report.js <输入json> [输出md]');
  return { input: resolve(input), output: resolve(output) };
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function link(label, url) {
  if (!url) return escapeCell(label || EMPTY_VALUE);
  return `[${escapeCell(label || url)}](${url})`;
}

function safeText(value) {
  return String(value ?? '').trim();
}
function countPattern(text, pattern) {
  return safeText(text).match(pattern)?.length || 0;
}

function normalizeScore(value, maxValue, weight) {
  if (!maxValue || !Number.isFinite(value) || value <= 0) return 0;
  return (value / maxValue) * weight;
}

function roundScore(value) {
  return Number(value.toFixed(SCORE_PRECISION));
}
function parseMetricNumber(rawValue) {
  if (typeof rawValue === 'number') return rawValue;
  const raw = safeText(rawValue).replace(/,/g, '').replace(/\+/g, '');
  if (!raw) return 0;
  const matched = raw.match(/^(\d+(?:\.\d+)?)(万|千|亿)?$/);
  if (!matched) return Number(raw) || 0;
  const unitMap = { 千: 1_000, 万: 10_000, 亿: 100_000_000 };
  const base = Number(matched[1]);
  const multiplier = unitMap[matched[2]] || 1;
  return base * multiplier;
}

function daysBetween(laterDate, earlierDate) {
  const later = new Date(laterDate);
  const earlier = new Date(earlierDate);
  if (Number.isNaN(later.getTime()) || Number.isNaN(earlier.getTime())) return FRESHNESS_WINDOW_DAYS;
  const ms = later.getTime() - earlier.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
function buildCommentStats(note) {
  const comments = Array.isArray(note.comments) ? note.comments : [];
  const subCommentCount = comments.reduce((sum, item) => sum + (item.subComments?.length || 0), 0);
  const text = comments
    .flatMap((item) => [item.content, ...(item.subComments || []).map((subItem) => subItem.content)])
    .join('\n');
  const totalLength = comments.reduce((sum, item) => sum + safeText(item.content).length, 0);
  return {
    commentCount: comments.length,
    subCommentCount,
    avgLength: comments.length ? totalLength / comments.length : 0,
    questionCount: countPattern(text, SIGNAL_PATTERNS.question),
    signalCount:
      countPattern(text, SIGNAL_PATTERNS.need) +
      countPattern(text, SIGNAL_PATTERNS.pain) +
      countPattern(text, SIGNAL_PATTERNS.compare) +
      countPattern(text, SIGNAL_PATTERNS.emotion),
    text,
  };
}
function buildKeywordStats(note, keyword) {
  const title = safeText(note.title);
  const desc = safeText(note.desc);
  const commentsText = buildCommentStats(note).text;
  const pattern = keyword ? new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu') : null;
  if (!pattern) return { titleHits: 0, descHits: 0, commentHits: 0, title, desc };
  return {
    titleHits: countPattern(title, pattern),
    descHits: countPattern(desc, pattern),
    commentHits: countPattern(commentsText, pattern),
    title,
    desc,
  };
}
function buildRawSignals(note, data) {
  const metrics = note.metrics || {};
  const comments = buildCommentStats(note);
  const keywordStats = buildKeywordStats(note, safeText(data.keyword));
  const descAndComments = [keywordStats.desc, comments.text].join('\n');
  const engagementValue =
    parseMetricNumber(metrics.likedCount) * ENGAGEMENT_WEIGHTS.like +
    parseMetricNumber(metrics.commentCount) * ENGAGEMENT_WEIGHTS.comment +
    parseMetricNumber(metrics.collectedCount) * ENGAGEMENT_WEIGHTS.collect +
    parseMetricNumber(metrics.shareCount) * ENGAGEMENT_WEIGHTS.share;
  return {
    engagementValue,
    discussionValue:
      comments.commentCount * 1.2 +
      comments.subCommentCount * 1.5 +
      comments.avgLength * 0.08 +
      comments.questionCount * 1.2,
    insightValue:
      countPattern(descAndComments, SIGNAL_PATTERNS.need) * 1.2 +
      countPattern(descAndComments, SIGNAL_PATTERNS.pain) * 1.4 +
      countPattern(descAndComments, SIGNAL_PATTERNS.compare) * 1.1 +
      countPattern(descAndComments, SIGNAL_PATTERNS.emotion),
    relevanceValue:
      keywordStats.titleHits * 3 +
      keywordStats.descHits * 2 +
      keywordStats.commentHits +
      (keywordStats.title.includes(data.keyword || '') && data.keyword ? 2 : 0),
    freshnessDays: daysBetween(data.fetchedAt || new Date().toISOString(), note.publishTimeNormalized),
    commentStats: comments,
  };
}
function collectMaxSignals(notes, data) {
  return notes.reduce((acc, note) => {
    const raw = buildRawSignals(note, data);
    return {
      engagement: Math.max(acc.engagement, raw.engagementValue),
      discussion: Math.max(acc.discussion, raw.discussionValue),
      insight: Math.max(acc.insight, raw.insightValue),
      relevance: Math.max(acc.relevance, raw.relevanceValue),
    };
  }, { engagement: 0, discussion: 0, insight: 0, relevance: 0 });
}
function freshnessScore(freshnessDays) {
  const ratio = 1 - Math.min(freshnessDays, FRESHNESS_WINDOW_DAYS) / FRESHNESS_WINDOW_DAYS;
  return ratio * WEIGHTS.freshness;
}
function evaluateNotes(data) {
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const maxSignals = collectMaxSignals(notes, data);
  const evaluated = notes.map((note) => {
    const raw = buildRawSignals(note, data);
    const relevanceScore = normalizeScore(raw.relevanceValue, maxSignals.relevance, WEIGHTS.relevance);
    const engagementScore = normalizeScore(raw.engagementValue, maxSignals.engagement, WEIGHTS.engagement);
    const discussionScore = normalizeScore(raw.discussionValue, maxSignals.discussion, WEIGHTS.discussion);
    const insightScore = normalizeScore(raw.insightValue, maxSignals.insight, WEIGHTS.insight);
    const totalScore = relevanceScore + engagementScore + discussionScore + insightScore + freshnessScore(raw.freshnessDays);
    return {
      ...note,
      evaluation: {
        totalScore: roundScore(totalScore),
        breakdown: {
          relevanceScore: roundScore(relevanceScore),
          engagementScore: roundScore(engagementScore),
          discussionScore: roundScore(discussionScore),
          freshnessScore: roundScore(freshnessScore(raw.freshnessDays)),
          insightScore: roundScore(insightScore),
        },
      },
    };
  });
  return evaluated
    .sort((left, right) => right.evaluation.totalScore - left.evaluation.totalScore)
    .map((note, index) => ({ ...note, evaluation: { ...note.evaluation, rank: index + 1 } }));
}
function commentSample(note) {
  return (note.comments || [])
    .slice(0, 2)
    .map((item) => `${item.user?.nickname || '匿名'}：${escapeCell(item.content).slice(0, 40)}`)
    .join('<br>');
}
function rankingRow(note) {
  const score = note.evaluation?.breakdown || {};
  return [
    note.evaluation?.rank || EMPTY_VALUE,
    link(note.title || note.id, note.originUrl || note.detailUrl),
    note.evaluation?.totalScore || 0,
    score.relevanceScore || 0,
    score.engagementScore || 0,
    score.discussionScore || 0,
    score.freshnessScore || 0,
    score.insightScore || 0,
    note.publishTimeNormalized || note.publishTimeRaw || EMPTY_VALUE,
    note.user?.nickname || EMPTY_VALUE,
    link('跳转', note.originUrl || note.detailUrl || ''),
  ];
}
function noteRow(note) {
  const metrics = note.metrics || {};
  const score = note.evaluation?.breakdown || {};
  return [
    note.evaluation?.rank || EMPTY_VALUE,
    link(note.title || note.id, note.originUrl || note.detailUrl),
    note.evaluation?.totalScore || 0,
    score.relevanceScore || 0,
    score.engagementScore || 0,
    score.discussionScore || 0,
    score.freshnessScore || 0,
    score.insightScore || 0,
    note.publishTimeRaw || EMPTY_VALUE,
    note.publishTimeNormalized || EMPTY_VALUE,
    note.user?.nickname || EMPTY_VALUE,
    note.type || EMPTY_VALUE,
    metrics.likedCount || EMPTY_VALUE,
    metrics.commentCount || EMPTY_VALUE,
    metrics.collectedCount || EMPTY_VALUE,
    metrics.shareCount || EMPTY_VALUE,
    metrics.fetchedCommentCount || note.commentCount || 0,
    link('原文', note.originUrl || note.detailUrl || ''),
    commentSample(note) || EMPTY_VALUE,
  ];
}
function tableLines(header, split, rows) {
  return [header, split, ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`), ''];
}
function buildSummary(data, rankedNotes) {
  const topNotes = rankedNotes.slice(0, TOP_RANK_LIMIT);
  return [
    '# 小红书调研表格报告：' + (data.keyword || '未命名关键词'),
    '',
    `- 抓取时间：${data.fetchedAt || EMPTY_VALUE}`,
    `- 抓取帖子数：${data.totalFetchedNotes || 0}`,
    `- 是否还有更多搜索结果：${data.searchHasMore ? '是' : '否'}`,
    `- 评估目标：混合向（传播表现 + 评论讨论价值 + 调研洞察）`,
    `- 排名方式：基于本次样本动态计算`,
    '',
    '## 评分维度',
    '',
    `- 相关性：${WEIGHTS.relevance} 分`,
    `- 热度：${WEIGHTS.engagement} 分`,
    `- 讨论度：${WEIGHTS.discussion} 分`,
    `- 新鲜度：${WEIGHTS.freshness} 分`,
    `- 洞察度：${WEIGHTS.insight} 分`,
    '',
    `## 综合排名 Top ${Math.min(TOP_RANK_LIMIT, topNotes.length)}`,
    '',
  ];
}
function buildMarkdown(data) {
  const rankedNotes = evaluateNotes(data);
  const summary = buildSummary(data, rankedNotes);
  const rankingHeader = '| 排名 | 帖子 | 综合分 | 相关性 | 热度 | 讨论度 | 新鲜度 | 洞察度 | 标准时间 | 作者 | 帖子链接 |';
  const rankingSplit = '|---:|---|---:|---:|---:|---:|---:|---:|---|---|---|';
  const detailHeader = '| 排名 | 标题 | 综合分 | 相关性 | 热度 | 讨论度 | 新鲜度 | 洞察度 | 发布时间 | 标准时间 | 作者 | 类型 | 点赞 | 评论 | 收藏 | 分享 | 已抓评论数 | 帖子链接 | 代表性评论 |';
  const detailSplit = '|---:|---|---:|---:|---:|---:|---:|---:|---|---|---|---|---:|---:|---:|---:|---:|---|---|';
  const rankingRows = rankedNotes.slice(0, TOP_RANK_LIMIT).map(rankingRow);
  const detailRows = rankedNotes.map(noteRow);
  return [
    ...summary,
    ...tableLines(rankingHeader, rankingSplit, rankingRows),
    '## 全量帖子明细表',
    '',
    ...tableLines(detailHeader, detailSplit, detailRows),
  ].join('\n');
}

async function main() {
  const { input, output } = parseArgs(process.argv);
  const data = JSON.parse(await readFile(input, 'utf8'));
  await writeFile(output, `${buildMarkdown(data)}\n`, 'utf8');
  console.log(`完成，已写入 ${output}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
