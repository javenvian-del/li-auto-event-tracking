import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {headers, normalize, hashImage} from './core.mjs';
import {digest, saveJSON, dataDirectory} from './distribution.mjs';

export function lark(args, {input, cwd} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('lark-cli', [...args, '--as', 'user', '--format', 'json'], {cwd, stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1'}});
    let out = '', err = '';
    child.stdout.on('data', b => {out += b;}); child.stderr.on('data', b => {err += b;});
    child.on('error', () => reject(Error('未找到可用的 lark-cli；由助手使用已授权的飞书连接或本机浏览器完成审核表')));
    child.on('close', code => {
      let value; try {value = JSON.parse(code === 0 ? out : err);} catch {reject(Error('飞书命令未返回可确认的结果，请检查本地操作记录，勿重复新建')); return;}
      if (code !== 0 || value.ok !== true || value.identity !== 'user') {
        const error = Error(value.error?.message || '飞书操作未成功，请核对本人授权');
        error.details = value.error; reject(error); return;
      }
      resolve(value.data);
    });
    child.stdin.on('error', () => {}); child.stdin.end(input ? JSON.stringify(input) : undefined);
  });
}
export function indexedCells(data) {
  if (data.has_more || !Array.isArray(data.ranges)) throw Error('审核表回读不完整');
  const cells = new Map();
  for (const range of data.ranges) {
    if (range.truncated || !range.actual_range || !range.row_indices || !range.col_indices) throw Error('审核表回读缺少完整坐标');
    for (const [i, row] of range.cells.entries()) for (const [j, cell] of row.entries()) cells.set(`${range.col_indices[j]}${range.row_indices[i]}`, cell);
  }
  return cells;
}
const text = cell => cell?.value === undefined ? (cell?.rich_text || []).map(x => x.text || '').join('') : String(cell.value);
export async function createReview(preparedFile, {call = lark, data = dataDirectory()} = {}) {
  const bytes = await fs.readFile(preparedFile), draft = JSON.parse(bytes);
  if (draft.status !== 'ready' || draft.issues?.length || !draft.rows?.length) throw Error('草稿尚有待确认项，请先完成整理');
  for (const [i, row] of draft.rows.entries()) {
    if (row.row !== i + 2 || normalize(row).expectedName !== row.expectedName || !row.image?.path || await hashImage(row.image.path) !== row.image.hash) throw Error('草稿字段或图片已变化，请重新整理');
  }
  const fingerprint = digest(bytes), directory = path.join(data, 'reviews', digest(path.resolve(preparedFile))), journalFile = path.join(directory, 'state.json');
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  const lockFile = path.join(directory, 'run.lock');
  const lock = await fs.open(lockFile, 'wx', 0o600).catch(() => {throw Error('这份审核表正在生成，请等待完成');});
  let state = {};
  const save = async patch => {state = {...state, ...patch}; await saveJSON(journalFile, state);};
  try {
    state = await fs.readFile(journalFile, 'utf8').then(JSON.parse).catch(error => {if (error.code === 'ENOENT') return {}; throw error;});
    if (state.fingerprint && state.fingerprint !== fingerprint) throw Error(`这份草稿已有生成记录，请在原审核表调整并重新预检：${state.url || '先核对云空间中的新表'}`);
    if (state.phase === 'creating' && !state.url) throw Error('上次新建表格结果未明确，请先核对云空间；禁止自动再次新建');
    const columns = Object.values(headers);
    const rows = draft.rows.map(r => [r.app, r.page, r.element, r.action, r.developer, r.tester, r.description, '', '', '']);
    if (!state.url) {
      // Check the command before recording an ambiguous external write.
      await call(['sheets', '+workbook-create', '--title', draft.title, '--sheets', '-', '--dry-run'], {input: {sheets: [{name: draft.sheetName, columns, data: rows, dtypes: Object.fromEntries(columns.map(c => [c, 'object']))}]}});
      await save({phase: 'creating', preparedFile: path.resolve(preparedFile), fingerprint});
      const created = await call(['sheets', '+workbook-create', '--title', draft.title, '--sheets', '-'], {input: {sheets: [{name: draft.sheetName, columns, data: rows, dtypes: Object.fromEntries(columns.map(c => [c, 'object']))}]}});
      const url = created.url || created.spreadsheet_url || created.spreadsheet?.url;
      await save({created, ...(url ? {url} : {})});
      if (!url) throw Error('表格已创建但未取得链接，请先查看生成记录，勿再次新建');
      const u = new URL(url);
      if (u.protocol !== 'https:' || !u.hostname.endsWith('.feishu.cn') || !/^\/sheets\//.test(u.pathname)) throw Error('新建表格返回了非预期链接');
      await save({phase: 'images', images: {}});
    }
    const info = await call(['sheets', '+workbook-info', '--url', state.url]);
    const sheets = (info.sheets || []).filter(s => (s.sheet_name || s.title) === draft.sheetName);
    if (sheets.length !== 1) throw Error('新建表格的工作表未唯一匹配');
    const id = sheets[0].sheet_id;
    const read = async range => indexedCells(await call(['sheets', '+cells-get', '--url', state.url, '--sheet-id', id, '--range', range]));
    const all = await read(`A1:J${draft.rows.length + 1}`);
    for (const [i, values] of [columns, ...rows].entries()) for (const [j, value] of values.entries()) {
      if (j === 7 && i > 0) continue;
      const cell = String.fromCharCode(65 + j) + (i + 1);
      if (!all.has(cell) || text(all.get(cell)) !== value) throw Error(`审核表 ${cell} 内容与草稿不同；停止写入，保留现有内容`);
    }
    for (const row of draft.rows) {
      const cell = `H${row.row}`;
      if (state.images?.[cell]?.status === 'done') {
        const image = all.get(cell)?.rich_text?.find(x => x.type === 'embed-image');
        if (image?.image_token !== state.images[cell].token) throw Error(`${cell} 图片在生成后发生变化，停止覆盖`);
        continue;
      }
      if (await hashImage(row.image.path) !== row.image.hash) throw Error(`${cell} 原图发生变化，请重新整理`);
      const current = (await read(cell)).get(cell), embedded = (current?.rich_text || []).filter(x => x.type === 'embed-image' && x.image_token);
      if (embedded.length) {
        throw Error(`${cell} 已有图片，但上次写入尚未核实，请先确认图片来源，停止覆盖`);
      } else {
        if (text(current)) throw Error(`${cell} 已有其他内容，停止覆盖`);
        await save({images: {...state.images, [cell]: {status: 'writing', hash: row.image.hash}}});
        await call(['sheets', '+cells-set-image', '--url', state.url, '--sheet-id', id, '--range', cell, '--image', './' + path.basename(row.image.path)], {cwd: path.dirname(row.image.path)});
      }
      const verified = (await read(cell)).get(cell);
      const image = verified?.rich_text?.find(x => x.type === 'embed-image' && x.image_token);
      if (!image) throw Error(`${cell} 图片写入后未能核实`);
      await save({images: {...state.images, [cell]: {status: 'done', hash: row.image.hash, token: image.image_token}}});
    }
    await save({phase: 'done', sheetId: id, completedAt: new Date().toISOString()});
    return {status: 'done', url: state.url, sheetName: draft.sheetName, sheetId: id, rows: draft.rows.length, images: draft.rows.length};
  } finally {await lock.close(); await fs.unlink(lockFile);}
}
