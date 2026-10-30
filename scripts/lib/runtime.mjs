import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {dataDirectory} from './distribution.mjs';

export async function playwright() {
  try {return await import('playwright');}
  catch {return import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);}
}
export function pageURL(config) {
  const event = new URL(config.platformUrl);
  if (event.protocol !== 'https:' || !(event.hostname === 'chehejia.com' || event.hostname.endsWith('.chehejia.com')) || !/\/event\/?$/.test(event.pathname)) throw Error('请提供运营平台事件管理页地址');
  const page = config.pagePlatformUrl ? new URL(config.pagePlatformUrl) : new URL(event);
  if (config.pagePlatformUrl && (page.origin !== event.origin || !/\/page\/?$/.test(page.pathname))) throw Error('页面管理地址须属于同一运营平台');
  page.pathname = page.pathname.replace(/\/event\/?$/, '/page'); page.search = ''; page.hash = '';
  return page.href;
}
export async function loadConfig() {
  return JSON.parse(await fs.readFile(path.join(dataDirectory(), 'config.json'), 'utf8').catch(() => {throw Error('请先配置本次运营平台地址');}));
}
export async function withBrowser(config, callback, {headless = true} = {}) {
  const state = path.resolve(config.stateDir || path.join(dataDirectory(), 'state'));
  await fs.mkdir(state, {recursive: true, mode: 0o700});
  const lockFile = path.join(state, 'run.lock');
  const lock = await fs.open(lockFile, 'wx', 0o600).catch(() => {throw Error('已有埋点操作正在运行，请等待完成');});
  let context;
  try {
    const {chromium} = await playwright();
    context = await chromium.launchPersistentContext(path.join(state, 'browser-profile'), {channel: config.channel || 'chrome', headless, acceptDownloads: false, viewport: {width: 1440, height: 1000}});
    return await callback(context);
  } finally {try {await context?.close();} finally {await lock.close(); await fs.unlink(lockFile);}}
}
export async function doctor() {
  const candidates = process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')] : process.platform === 'win32' ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(p => path.join(p, 'Google/Chrome/Application/chrome.exe')) : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];
  let chrome = false;
  for (const file of candidates) if (await fs.stat(file).catch(() => null)) chrome = true;
  const browserLibrary = await playwright().then(() => true).catch(() => false);
  const result = {node: process.versions.node, os: process.platform, chrome, playwright: browserLibrary, localExecution: 'agent_must_verify', networkAndLogin: 'not_checked'};
  return {...result, status: chrome && browserLibrary ? 'dependencies_ready' : 'setup_needed'};
}
