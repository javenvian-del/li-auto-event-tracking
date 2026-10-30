import fs from 'node:fs/promises';
import path from 'node:path';
import {normalize, headers, hashImage} from './core.mjs';
import {saveJSON} from './distribution.mjs';

const aliases = {
  app: ['app', '应用', '所属应用'], page: ['page', '页面', '页面名称'],
  element: ['element', '元素名称', '元素', '按钮名称'], action: ['action', '动作类型', '动作'],
  developer: ['developer', '开发负责人', '研发负责人'], tester: ['tester', '测试负责人'], description: ['description', '事件描述', '触发时机', '触发条件']
};
export function mapEvent(raw, index) {
  const result = {row: index + 2};
  for (const [key, options] of Object.entries(aliases)) {
    const values = [...new Set(options.map(k => raw[k]).filter(v => v !== undefined && v !== null && String(v).trim() !== '').map(v => String(v).trim()))];
    if (values.length > 1) throw Error(`第${index + 1}项${headers[key]}有冲突，需结合 PRD 核对`);
    result[key] = values[0] || '';
  }
  if (!['点击', '曝光', '输入', '分享', '点击/click', '曝光/show', '输入/input', '分享/share'].includes(result.action)) throw Error('动作须明确为点击、曝光、输入或分享；组合动作请先结合 PRD 拆分');
  if (!raw.source?.ref || !['prd-table', 'prd-inferred', 'prepared'].includes(raw.source?.kind)) throw Error(`第${index + 1}项缺少来源位置`);
  if (raw.eventName || raw.eventId || raw['事件标识'] || raw['事件名称']) throw Error('草稿包含已有事件名称或标识，请先确认复用范围；已有标准表应走表格模式');
  return {...normalize(result), source: raw.source};
}
export async function resolveImage(raw, row, {base, directory, lookup, cache}) {
  const image = raw.image;
  // A known PRD image that could not be downloaded is still a PRD image, not a missing image.
  if (image?.source === 'prd' || image?.source === 'user') {
    if (!image.path) throw Error('原文已有截图但尚未取得图片文件，请先下载原图');
    const file = path.resolve(base, image.path);
    await hashImage(file);
    return {...image, path: file};
  }
  if (image && image.source !== 'missing') throw Error('图片来源须为 prd、user 或 missing；平台截图由脚本匹配下载');
  const key = `${row.app}\n${row.page}`;
  if (!cache.has(key)) cache.set(key, lookup(row.app, row.page, directory));
  return await cache.get(key);
}
export async function prepareDraft(manifestFile, directory, lookup) {
  const raw = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (!raw.title || !Array.isArray(raw.events) || !raw.events.length) throw Error('草稿须有 title 和非空 events');
  const base = path.dirname(path.resolve(manifestFile));
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  const rows = [], issues = [], seen = new Set(), cache = new Map();
  for (const [index, item] of raw.events.entries()) {
    try {
      const row = mapEvent(item, index), key = `${row.app}\n${row.expectedName}`;
      if (seen.has(key)) throw Error('同应用中出现重复事件，需核对或合并来源');
      seen.add(key);
      const image = await resolveImage(item, row, {base, directory: path.join(directory, 'images'), lookup, cache});
      const imageHash = await hashImage(image.path);
      rows.push({...row, image: {...image, hash: imageHash}});
    } catch (error) {issues.push({event: index + 1, source: item.source, message: error.message});}
  }
  const columns = Object.values(headers);
  const result = {schemaVersion: 1, status: issues.length ? 'needs_review' : 'ready', title: raw.title, sheetName: raw.sheetName || '埋点审核', rows, issues, sourceManifest: path.resolve(manifestFile)};
  await saveJSON(path.join(directory, 'prepared.json'), result);
  if (issues.length) {
    for (const name of ['review-payload.json', 'review.csv']) await fs.rm(path.join(directory, name), {force: true});
  } else {
    const data = rows.map(r => [r.app, r.page, r.element, r.action, r.developer, r.tester, r.description, '', '', '']);
    const payload = {sheets: [{name: result.sheetName, columns, dtypes: Object.fromEntries(columns.map(x => [x, 'object'])), data}]};
    await saveJSON(path.join(directory, 'review-payload.json'), payload);
    const csv = [columns, ...data].map(row => row.map(s => '"' + String(s).replaceAll('"', '""') + '"').join(',')).join('\r\n');
    await fs.writeFile(path.join(directory, 'review.csv'), '\uFEFF' + csv, {mode: 0o600});
  }
  return {status: result.status, total: raw.events.length, ready: rows.length, images: rows.reduce((x, r) => (x[r.image.source] = (x[r.image.source] || 0) + 1, x), {}), issues, prepared: path.join(directory, 'prepared.json')};
}
