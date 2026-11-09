import fs from 'node:fs/promises';

export const platformAddressPrompt = '首次使用，请提供用户增长运营中心的「事件管理」页面网址。为避免系统地址泄漏，技能不内置真实网址；配置只保存在你的电脑，不会随技能发布到公开仓库，后续自动复用。';

function httpsURL(value, label) {
  let url;
  try {url = new URL(value);} catch {throw Error(`${label}不是有效的网址`);}
  if (url.protocol !== 'https:' || url.username || url.password) throw Error(`${label}须使用 HTTPS，且不能包含账号或密码`);
  return url;
}

export function platformURL(config) {
  if (!config.platformUrl) throw Error(platformAddressPrompt);
  const url = httpsURL(config.platformUrl, '运营平台网址');
  if (!/\/event\/?$/.test(url.pathname)) throw Error('请提供用户增长运营中心的事件管理页网址');
  return url;
}

export function pageURL(config) {
  const event = platformURL(config);
  const page = config.pagePlatformUrl ? httpsURL(config.pagePlatformUrl, '页面管理网址') : new URL(event);
  if (config.pagePlatformUrl && (page.origin !== event.origin || !/\/page\/?$/.test(page.pathname))) throw Error('页面管理地址须属于本机配置的同一运营平台');
  page.pathname = page.pathname.replace(/\/event\/?$/, '/page'); page.search = ''; page.hash = '';
  return page.href;
}

export function imageOrigin(value) {
  const url = httpsURL(value, '图片来源');
  if (url.pathname !== '/' || url.search || url.hash) throw Error('图片来源须为 HTTPS 域名地址，不包含文件路径、参数或片段');
  return url.origin;
}

export function validatePlatformConfig(config) {
  platformURL(config); pageURL(config);
  if (config.imageOrigins !== undefined && !Array.isArray(config.imageOrigins)) throw Error('本机图片来源配置须为数组');
  for (const value of config.imageOrigins || []) imageOrigin(value);
  return config;
}

export function configurePlatform(previous, {platformUrl = previous.platformUrl, pagePlatformUrl} = {}) {
  const event = platformURL({platformUrl});
  let sameOrigin = false;
  try {sameOrigin = platformURL(previous).origin === event.origin;} catch {}
  const next = {...previous, platformUrl: event.href};
  // Approval for one platform's image hosts does not transfer to another platform.
  if (!sameOrigin) {delete next.pagePlatformUrl; delete next.imageOrigins;}
  if (pagePlatformUrl !== undefined) next.pagePlatformUrl = pagePlatformUrl;
  return validatePlatformConfig(next);
}

export function assertImageURL(config, value) {
  validatePlatformConfig(config);
  const url = httpsURL(value, '页面图片网址');
  const origins = new Set([platformURL(config).origin, ...(config.imageOrigins || []).map(imageOrigin)]);
  if (!origins.has(url.origin)) {
    const error = Error(`页面图片来源尚未配置：${url.origin}。请核对并确认来源后保存到本机配置，再重试补图。`);
    error.code = 'IMAGE_ORIGIN_NOT_CONFIGURED';
    throw error;
  }
  return url;
}

export async function platformSetupStatus(configFile) {
  let config;
  try {config = JSON.parse(await fs.readFile(configFile, 'utf8'));}
  catch (error) {
    return error.code === 'ENOENT' ? {status: 'needs_setup', prompt: platformAddressPrompt}
      : {status: 'needs_attention', message: '本机平台配置无法读取，请先核对配置；不会自动覆盖或重新选址。'};
  }
  if (!config.platformUrl) return {status: 'needs_setup', prompt: platformAddressPrompt};
  try {validatePlatformConfig(config); return {status: 'configured'};}
  catch {return {status: 'needs_attention', message: '本机平台网址或图片来源配置无效，请先核对；真实地址仍只保存在本机。'};}
}
