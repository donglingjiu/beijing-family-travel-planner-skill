import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const XHS_URLS = Object.freeze([
  'https://www.xiaohongshu.com',
  'https://edith.xiaohongshu.com',
]);
const DEFAULT_OUTPUT_FILE = 'xhs_cookie.txt';

function getEnv(name) {
  return process.env[name]?.trim() || '';
}

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--browser-url' && next) options.browserUrl = next;
    if (arg === '--output' && next) options.output = next;
    if (arg === '--stdout') options.stdout = true;
  }
  return options;
}

function resolveBrowserUrl(options) {
  return options.browserUrl || getEnv('XHS_BROWSER_URL') || getEnv('XHS_CDP_URL');
}

function buildCookieHeader(cookies) {
  return cookies
    .filter((item, index, list) => item.name && item.value && list.findIndex((entry) => entry.name === item.name) === index)
    .map((item) => `${item.name}=${item.value}`)
    .join('; ');
}

async function fetchCookies(browserUrl) {
  const browser = await chromium.connectOverCDP(browserUrl);
  try {
    const contexts = browser.contexts();
    if (contexts.length === 0) throw new Error(`CDP 浏览器 ${browserUrl} 没有可用 context`);
    const cookies = await contexts[0].cookies(XHS_URLS);
    const cookieHeader = buildCookieHeader(cookies);
    if (!cookieHeader) throw new Error('未从 CDP 浏览器中读取到小红书 cookie');
    return cookieHeader;
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const browserUrl = resolveBrowserUrl(options);
  if (!browserUrl) throw new Error('缺少 --browser-url，或环境变量 XHS_BROWSER_URL / XHS_CDP_URL');
  const cookieHeader = await fetchCookies(browserUrl);
  if (options.stdout) {
    console.log(cookieHeader);
    return;
  }
  const output = resolve(options.output || getEnv('XHS_COOKIE_OUTPUT_FILE') || DEFAULT_OUTPUT_FILE);
  await writeFile(output, `${cookieHeader}\n`, 'utf8');
  console.log(`已导出完整 cookie 到 ${output}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
