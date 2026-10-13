import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { BRIDGE_SOURCE } from './xhs_bridge.js';
import { createPage } from './xhs_session.js';

loadDotenv();

const XHS_ORIGIN = 'https://www.xiaohongshu.com';
const IMAGE_FORMATS = Object.freeze(['jpg', 'webp', 'avif']);
const IMAGE_FORMATS_QUERY = IMAGE_FORMATS.join(',');
const DEFAULTS = Object.freeze({
  notes: 20,
  comments: 30,
  subComments: 20,
  pageSize: 20,
  headless: true,
  prepareLogin: false,
});
const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--prepare-login') options.prepareLogin = true;
    if (arg === '--keyword' && next) options.keyword = next;
    if (arg === '--notes' && next) options.notes = Number(next);
    if (arg === '--comments' && next) options.comments = Number(next);
    if (arg === '--sub-comments' && next) options.subComments = Number(next);
    if (arg === '--output' && next) options.output = next;
    if (arg === '--headless' && next) options.headless = next !== 'false';
    if (arg === '--cookie-file' && next) options.cookieFile = next;
    if (arg === '--user-data-dir' && next) options.userDataDir = next;
    if (arg === '--browser-url' && next) options.browserUrl = next;
    if (arg === '--login-timeout-ms' && next) options.loginTimeoutMs = Number(next);
  }
  return options;
}

function buildOutputPath(options) {
  if (options.output) return resolve(options.output);
  const safeKeyword = (options.keyword || 'xhs').replace(/[^\p{L}\p{N}_-]+/gu, '_');
  return resolve(`output_${safeKeyword}.json`);
}

function buildOriginUrl(id) {
  return `${XHS_ORIGIN}/explore/${id}`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizePublishTime(rawValue, now) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return raw;
  if (/^\d{2}-\d{2}$/u.test(raw)) return `${now.getFullYear()}-${raw}`;
  if (raw === '刚刚') return formatDate(now);
  if (raw === '昨天') return formatDate(new Date(now.getTime() - DAY_MS));
  const relativePatterns = [
    [/^(\d+)分钟前$/u, (value) => new Date(now.getTime() - value * 60 * 1000)],
    [/^(\d+)小时前$/u, (value) => new Date(now.getTime() - value * 60 * 60 * 1000)],
    [/^(\d+)天前$/u, (value) => new Date(now.getTime() - value * DAY_MS)],
    [/^(\d+)周前$/u, (value) => new Date(now.getTime() - value * 7 * DAY_MS)],
    [/^(\d+)个月前$/u, (value) => new Date(now.getFullYear(), now.getMonth() - value, now.getDate())],
    [/^(\d+)年前$/u, (value) => new Date(now.getFullYear() - value, now.getMonth(), now.getDate())],
  ];
  for (const [pattern, factory] of relativePatterns) {
    const matched = raw.match(pattern);
    if (!matched) continue;
    return formatDate(factory(Number(matched[1])));
  }
  return raw;
}

async function installBridge(page) {
  await page.evaluate((payload) => {
    const factory = eval(payload.source);
    factory({ imageFormats: payload.imageFormats, imageFormatsQuery: payload.imageFormatsQuery });
  }, { source: BRIDGE_SOURCE, imageFormats: IMAGE_FORMATS, imageFormatsQuery: IMAGE_FORMATS_QUERY });
}

function searchNotes(page, options) {
  return page.evaluate((payload) => window.__xhsBridge.searchNotes(payload), {
    keyword: options.keyword,
    pageSize: options.pageSize,
    searchId: `cli_${randomUUID()}`,
    sessionId: randomUUID(),
  });
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function getNoteCard(note) {
  return note?.noteCard || note?.note_card || {};
}

function getInteractInfo(noteCard) {
  return noteCard?.interactInfo || noteCard?.interact_info || {};
}

function getPublishTimeFromNoteCard(noteCard) {
  const tags = noteCard?.cornerTagInfo || noteCard?.corner_tag_info || [];
  const publishTag = tags.find((item) => item?.type === 'publish_time');
  return publishTag?.text || '';
}

function getNoteId(note) {
  return pickFirst(note?.id, note?.noteId, note?.note_id, '');
}

function getNoteXsecToken(note, cardMeta = {}) {
  return pickFirst(note?.xsecToken, note?.xsec_token, cardMeta.xsecToken, '');
}

function extractSearchCards(page) {
  return page.evaluate(() => {
    const toAbsolute = (href) => new URL(href, location.origin).toString();
    return [...document.querySelectorAll('section.note-item')].map((item) => {
      const hiddenExplore = item.querySelector('a[href^="/explore/"]');
      const detailLink = item.querySelector('a.cover[href*="/search_result/"]');
      const detailPath = detailLink?.getAttribute('href') || '';
      const detailUrl = detailPath ? toAbsolute(detailPath) : '';
      const detailParams = detailUrl ? new URL(detailUrl).searchParams : null;
      const title = item.querySelector('.title')?.textContent?.trim() || '';
      const author = item.querySelector('.name')?.textContent?.trim() || '';
      const publishTime = item.querySelector('.time')?.textContent?.trim() || '';
      const searchLikeCount = item.querySelector('.count')?.textContent?.trim() || '';
      const explorePath = hiddenExplore?.getAttribute('href') || '';
      const id = explorePath.split('/').filter(Boolean).pop() || '';
      return {
        author,
        detailUrl,
        id,
        originUrl: explorePath ? toAbsolute(explorePath) : '',
        publishTime,
        searchLikeCount,
        title,
        xsecToken: detailParams?.get('xsec_token') || '',
      };
    });
  });
}

function buildNoteMetrics(noteCard, note, cardMeta, comments) {
  const detailInteractInfo = getInteractInfo(noteCard);
  const searchInteractInfo = getInteractInfo(getNoteCard(note));
  return {
    likedCount: pickFirst(detailInteractInfo.likedCount, detailInteractInfo.liked_count, searchInteractInfo.likedCount, searchInteractInfo.liked_count, cardMeta.searchLikeCount, ''),
    commentCount: pickFirst(detailInteractInfo.commentCount, detailInteractInfo.comment_count, searchInteractInfo.commentCount, searchInteractInfo.comment_count, ''),
    collectedCount: pickFirst(detailInteractInfo.collectedCount, detailInteractInfo.collected_count, searchInteractInfo.collectedCount, searchInteractInfo.collected_count, ''),
    shareCount: pickFirst(detailInteractInfo.shareCount, detailInteractInfo.sharedCount, detailInteractInfo.shared_count, searchInteractInfo.shareCount, searchInteractInfo.sharedCount, searchInteractInfo.shared_count, ''),
    fetchedCommentCount: comments.length,
  };
}

async function fetchNote(page, note, cardMeta, options, now) {
  const noteId = getNoteId(note);
  const xsecToken = getNoteXsecToken(note, cardMeta);
  const detail = await page.evaluate((payload) => window.__xhsBridge.fetchNoteDetail(payload), { noteId, xsecToken });
  const comments = await page.evaluate((payload) => window.__xhsBridge.fetchComments(payload), {
    commentLimit: options.comments,
    noteId,
    subCommentLimit: options.subComments,
    xsecToken,
  });
  const detailNoteCard = getNoteCard(detail?.items?.[0]);
  const searchNoteCard = getNoteCard(note);
  const noteCard = Object.keys(detailNoteCard).length > 0 ? detailNoteCard : searchNoteCard;
  const publishTimeRaw = cardMeta.publishTime || getPublishTimeFromNoteCard(searchNoteCard) || getPublishTimeFromNoteCard(detailNoteCard) || '';
  return {
    commentCount: comments.length,
    comments,
    desc: pickFirst(noteCard.desc, noteCard.description, noteCard.content, noteCard.descText, noteCard.desc_text, ''),
    detailUrl: cardMeta.detailUrl || '',
    id: noteId,
    interactInfo: getInteractInfo(noteCard),
    metrics: buildNoteMetrics(noteCard, note, cardMeta, comments),
    originUrl: cardMeta.originUrl || buildOriginUrl(noteId),
    publishTimeNormalized: normalizePublishTime(publishTimeRaw, now),
    publishTimeRaw,
    title: pickFirst(noteCard.title, noteCard.displayTitle, noteCard.display_title, searchNoteCard.title, searchNoteCard.displayTitle, searchNoteCard.display_title, cardMeta.title, ''),
    type: pickFirst(noteCard.type, searchNoteCard.type, ''),
    user: pickFirst(noteCard.user, searchNoteCard.user, null),
    xsecToken,
  };
}

async function fetchAllNotes(page, options) {
  const now = new Date();
  const [searchResult, searchCards] = await Promise.all([searchNotes(page, options), extractSearchCards(page)]);
  const cardMap = new Map(searchCards.map((item) => [item.id, item]));
  const notes = (searchResult.items || []).slice(0, options.notes);
  const results = [];
  for (const note of notes) results.push(await fetchNote(page, note, cardMap.get(note.id) || {}, options, now));
  return { hasMore: searchResult.hasMore, notes: results };
}

async function writeOutput(options, result) {
  const payload = {
    fetchedAt: new Date().toISOString(),
    keyword: options.keyword,
    notes: result.notes,
    searchHasMore: result.hasMore,
    totalFetchedNotes: result.notes.length,
  };
  const filePath = buildOutputPath(options);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`完成，已写入 ${filePath}`);
}

async function run(options) {
  const session = await createPage(options);
  try {
    console.log(`登录态来源: ${session.authSource}`);
    if (options.prepareLogin) {
      console.log('浏览器登录态已就绪，可继续执行抓取命令。');
      return;
    }
    await installBridge(session.page);
    await writeOutput(options, await fetchAllNotes(session.page, options));
  } finally {
    await session.close();
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (!options.prepareLogin && !options.keyword) throw new Error('缺少参数 --keyword；如果只是准备登录态，请改用 --prepare-login');
  await run(options);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
