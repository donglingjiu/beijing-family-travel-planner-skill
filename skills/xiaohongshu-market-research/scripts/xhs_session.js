import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const XHS_ORIGIN = 'https://www.xiaohongshu.com';
const XHS_EXPLORE_URL = `${XHS_ORIGIN}/explore`;
const XHS_AUTH_URLS = Object.freeze([XHS_ORIGIN, XHS_EXPLORE_URL, 'https://edith.xiaohongshu.com']);
const DEFAULT_USER_DATA_DIR = '.xhs_user_data';
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_POLL_INTERVAL_MS = 1000;
const LOGIN_COOKIE_PATTERN = /^web_session(?:_.+)?$/u;
const LOGIN_ID_TOKEN_COOKIE = 'id_token';
const CHROME_CANDIDATES = Object.freeze([
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]);

function getEnv(name) {
  return process.env[name]?.trim() || '';
}

function getNumberEnv(name, fallback) {
  const value = Number(getEnv(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveChromePath() {
  const customPath = getEnv('XHS_CHROME_PATH');
  if (customPath) return customPath;
  const matched = CHROME_CANDIDATES.find((item) => existsSync(item));
  if (matched) return matched;
  throw new Error('未找到 Chrome/Chromium，可设置环境变量 XHS_CHROME_PATH 指向浏览器可执行文件');
}

function resolveUserDataDir(options) {
  return resolve(options.userDataDir || getEnv('XHS_USER_DATA_DIR') || DEFAULT_USER_DATA_DIR);
}

function resolveBrowserUrl(options) {
  return options.browserUrl || getEnv('XHS_BROWSER_URL') || getEnv('XHS_CDP_URL');
}

function resolveLoginTimeoutMs(options) {
  if (Number.isFinite(options.loginTimeoutMs) && options.loginTimeoutMs > 0) return options.loginTimeoutMs;
  return getNumberEnv('XHS_LOGIN_TIMEOUT_MS', DEFAULT_LOGIN_TIMEOUT_MS);
}

async function loadCookieHeader(options) {
  const directCookie = getEnv('XHS_COOKIE');
  if (directCookie) return directCookie;
  const cookieFile = options.cookieFile || getEnv('XHS_COOKIE_FILE');
  if (!cookieFile) throw new Error('缺少 cookie。请使用 XHS_COOKIE、.env 中的 XHS_COOKIE，或通过 XHS_COOKIE_FILE/--cookie-file 提供 cookie 文件');
  return (await readFile(resolve(cookieFile), 'utf8')).trim();
}

function hasDirectCookieInput(options) {
  return Boolean(getEnv('XHS_COOKIE') || options.cookieFile || getEnv('XHS_COOKIE_FILE'));
}

function parseCookieHeader(cookieHeader) {
  return cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf('=');
      return { name: item.slice(0, index), value: item.slice(index + 1), domain: '.xiaohongshu.com', path: '/', secure: true };
    });
}

async function openSearchPage(page, options) {
  const url = `${XHS_ORIGIN}/search_result?keyword=${encodeURIComponent(options.keyword)}&source=web_explore_feed`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.webpackChunkxhs_pc_web), null, { timeout: 30000 });
}

async function loadXhsCookies(context) {
  return context.cookies(XHS_AUTH_URLS);
}

function hasLoginCookies(cookies) {
  const hasSessionCookie = cookies.some((item) => LOGIN_COOKIE_PATTERN.test(item.name) && item.value);
  const hasIdTokenCookie = cookies.some((item) => item.name === LOGIN_ID_TOKEN_COOKIE && item.value);
  return hasSessionCookie && hasIdTokenCookie;
}

async function readPageLoginState(page) {
  try {
    await page.waitForFunction(() => Boolean(window.__INITIAL_STATE__?.user), null, { timeout: 5000 });
  } catch (error) {
    void error;
  }

  try {
    return await page.evaluate(() => {
      const unwrap = (value) => (value && typeof value === 'object' && '__v_isRef' in value ? value._value : value);
      const userState = window.__INITIAL_STATE__?.user;
      if (!userState) return null;
      const loggedIn = unwrap(userState.loggedIn);
      const userInfo = unwrap(userState.userInfo) || {};
      const userId = userInfo.userId || userInfo.user_id || '';
      return Boolean(loggedIn || userId);
    });
  } catch (error) {
    void error;
    return null;
  }
}

async function hasActiveLogin(context, page) {
  const cookies = await loadXhsCookies(context);
  if (!hasLoginCookies(cookies)) return false;
  const pageState = await readPageLoginState(page);
  return pageState !== false;
}

function buildLoginHint(options, sourceLabel) {
  const profilePath = resolveUserDataDir(options);
  return [
    `当前 ${sourceLabel} 未检测到小红书登录态。`,
    `当前 profile: ${profilePath}`,
    '如果你是在 OpenClaw 的 browser 工具里登录，请确认它与本 skill 使用的是同一个 XHS_USER_DATA_DIR；不同 Chromium 实例不会共享 cookie。',
    '可改用以下任一方案：',
    '1. 执行 node scripts/xhs_fetch.js --prepare-login --headless false，使用同一个 profile 扫码登录；',
    '2. 设置 XHS_COOKIE 或 XHS_COOKIE_FILE；',
    '3. 如果已有可复用的远程浏览器，设置 XHS_BROWSER_URL / XHS_CDP_URL 通过 CDP 连接。',
  ].join(' ');
}

async function waitForLogin(page, context, options, sourceLabel) {
  const timeoutMs = resolveLoginTimeoutMs(options);
  console.log(`未检测到登录态，等待手动登录（最长 ${Math.ceil(timeoutMs / 1000)} 秒）...`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasActiveLogin(context, page)) return;
    await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
  }
  throw new Error(`${buildLoginHint(options, sourceLabel)} 等待超时 ${timeoutMs}ms。`);
}

async function ensureBrowserLogin(context, options, sourceLabel) {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(XHS_EXPLORE_URL, { waitUntil: 'domcontentloaded' });
  if (await hasActiveLogin(context, page)) return page;
  if (!options.headless || options.prepareLogin) {
    await waitForLogin(page, context, options, sourceLabel);
    return page;
  }
  throw new Error(buildLoginHint(options, sourceLabel));
}

async function createCookieInjectedPage(options) {
  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: options.headless });
  const context = await browser.newContext();
  await context.addCookies(parseCookieHeader(await loadCookieHeader(options)));
  const page = await ensureBrowserLogin(context, options, '显式 cookie');
  if (!options.prepareLogin) await openSearchPage(page, options);
  return { authSource: 'explicit-cookie', close: () => browser.close(), page };
}

async function createBrowserProfilePage(options) {
  const session = await openLoggedInProfileContext(options);
  if (!options.prepareLogin) await openSearchPage(session.page, options);
  return { authSource: `profile:${session.userDataDir}`, close: session.close, page: session.page };
}

export async function openLoggedInProfileContext(options = {}) {
  const userDataDir = resolveUserDataDir(options);
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: resolveChromePath(),
    headless: options.headless,
  });
  const page = await ensureBrowserLogin(context, options, '浏览器 profile');
  return { close: () => context.close(), context, page, userDataDir };
}

async function createConnectedBrowserPage(options) {
  const browserUrl = resolveBrowserUrl(options);
  if (!browserUrl) return null;
  const browser = await chromium.connectOverCDP(browserUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`CDP 浏览器 ${browserUrl} 没有可用 context`);
  const page = await ensureBrowserLogin(context, options, 'CDP 浏览器');
  if (!options.prepareLogin) await openSearchPage(page, options);
  return { authSource: `cdp:${browserUrl}`, close: () => browser.close(), page };
}

export async function createPage(options) {
  if (options.prepareLogin) return createBrowserProfilePage(options);

  let cdpError = null;
  const browserSession = await createConnectedBrowserPage(options).catch((error) => {
    cdpError = error;
    console.warn(`连接 CDP 浏览器失败，改用其他登录态来源: ${error?.message || error}`);
    return null;
  });
  if (browserSession) return browserSession;
  try {
    return await createBrowserProfilePage(options);
  } catch (error) {
    if (!hasDirectCookieInput(options)) {
      if (!cdpError) throw error;
      throw new Error(`CDP 浏览器不可用，且浏览器 profile 也未取到登录态。CDP: ${cdpError?.message || cdpError} Profile: ${error?.message || error}`);
    }
    console.warn(`浏览器 profile 未取到登录态，改用显式 cookie: ${error?.message || error}`);
    return createCookieInjectedPage(options);
  }
}
