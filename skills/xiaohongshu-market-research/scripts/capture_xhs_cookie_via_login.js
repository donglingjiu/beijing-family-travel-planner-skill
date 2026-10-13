import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { openLoggedInProfileContext } from './xhs_session.js';

loadDotenv();

const DEFAULT_OUTPUT_FILE = 'xhs_cookie.txt';
const DEFAULT_HEADLESS = false;
const XHS_AUTH_URLS = Object.freeze([
  'https://www.xiaohongshu.com',
  'https://edith.xiaohongshu.com',
]);

function getEnv(name) {
  return process.env[name]?.trim() || '';
}

function parseArgs(argv) {
  const options = { headless: DEFAULT_HEADLESS };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--output' && next) options.output = next;
    if (arg === '--stdout') options.stdout = true;
    if (arg === '--headless' && next) options.headless = next !== 'false';
    if (arg === '--user-data-dir' && next) options.userDataDir = next;
    if (arg === '--login-timeout-ms' && next) options.loginTimeoutMs = Number(next);
  }
  return options;
}

function buildCookieHeader(cookies) {
  return cookies
    .filter((item, index, list) => item.name && item.value && list.findIndex((entry) => entry.name === item.name) === index)
    .map((item) => `${item.name}=${item.value}`)
    .join('; ');
}

async function main() {
  const options = parseArgs(process.argv);
  const output = resolve(options.output || getEnv('XHS_COOKIE_OUTPUT_FILE') || DEFAULT_OUTPUT_FILE);
  const session = await openLoggedInProfileContext({ ...options, prepareLogin: true });
  try {
    const cookies = await session.context.cookies(XHS_AUTH_URLS);
    const cookieHeader = buildCookieHeader(cookies);
    if (!cookieHeader) throw new Error('登录成功后仍未读取到小红书 cookie');
    if (options.stdout) {
      console.log(cookieHeader);
      return;
    }
    await writeFile(output, `${cookieHeader}\n`, 'utf8');
    console.log(`浏览器登录态已导出到 ${output}`);
    console.log(`后续可直接设置 XHS_COOKIE_FILE=${output}`);
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
