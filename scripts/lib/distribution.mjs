import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

export const defaultReleaseSource = Object.freeze({baseUrl: 'https://raw.githubusercontent.com/javenvian-del/li-auto-event-tracking/main/'});
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const dataDirectory = () => path.resolve(process.env.LI_AUTO_TRACKING_DATA || path.join(os.homedir(), 'Documents', 'Codex', 'li-auto-event-tracking-data'));
const exists = async p => Boolean(await fs.stat(p).catch(() => null));
export async function saveJSON(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), {mode: 0o600});
  await fs.rename(tmp, file);
}
export function compareVersions(a, b) {
  const parse = s => {
    if (!/^\d+\.\d+\.\d+$/.test(s)) throw Error('版本号必须是 major.minor.patch');
    return s.split('.').map(Number);
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export function validateRelease(release) {
  if (release.schemaVersion !== 1 || !release.files || Array.isArray(release.files)) throw Error('发布清单格式不支持');
  compareVersions(release.version, '0.0.0');
  const files = Object.entries(release.files);
  if (files.length < 5 || files.length > 150) throw Error('发布文件数量异常');
  for (const [name, hash] of files) {
    if (!/^(?:SKILL\.md|README\.md|package(?:-lock)?\.json|run\.(?:sh|cmd)|install\.sh|agents\/[\w.-]+\.yaml|(?:scripts|references|test)\/[\w./-]+\.(?:mjs|md|json))$/.test(name) || name.split('/').some(x => !x || x === '.' || x === '..') || !/^[a-f0-9]{64}$/.test(hash)) throw Error(`发布清单包含非法文件：${name}`);
  }
  for (const name of ['SKILL.md', 'package.json', 'run.sh', 'scripts/control.mjs', 'scripts/lib/distribution.mjs']) if (!release.files[name]) throw Error(`发布清单缺少 ${name}`);
  return release;
}
export async function loadUpdateSource(data = dataDirectory()) {
  const source = await fs.readFile(path.join(data, 'update-source.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return defaultReleaseSource;
    throw Error('更新源配置无法读取');
  });
  let url;
  try {url = new URL(source.baseUrl);} catch {throw Error('更新源地址无效');}
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) throw Error('更新源须为 HTTPS 目录地址，不能包含凭据、查询参数或片段');
  if (url.hostname === 'raw.githubusercontent.com' && source.tokenEnv) throw Error('公开下载地址不应携带个人令牌；私有库请使用授权接口');
  if (source.tokenEnv && !/^[A-Z][A-Z0-9_]*$/.test(source.tokenEnv)) throw Error('tokenEnv 须为环境变量名称，不能填写令牌');
  if (url.hostname === 'api.github.com' && !source.tokenEnv) throw Error('GitHub 私有更新源需要配置本人令牌的环境变量名称');
  return {baseUrl: url.href, ...(source.tokenEnv ? {tokenEnv: source.tokenEnv} : {})};
}
function validateDownloadName(name) {
  if (!/^[\w./-]+$/.test(name) || name.split('/').some(x => !x || x === '.' || x === '..')) throw Error('更新文件路径无效');
}
// The agent downloads fresh files with its authenticated connector; no connector token enters this process.
export function folderDownloader(folder, source) {
  const download = async name => {
    validateDownloadName(name);
    const base = await fs.realpath(path.resolve(folder));
    const file = path.join(base, name), real = await fs.realpath(file);
    if (!real.startsWith(base + path.sep)) throw Error('下载文件不得引用目录外内容');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 2_000_000) throw Error('下载文件格式或大小异常');
    return fs.readFile(file);
  };
  download.sourceId = digest(JSON.stringify(source));
  return download;
}
export function sourceDownloader(source, {request = fetch, env = process.env} = {}) {
  const headers = {'Cache-Control': 'no-cache'};
  if (source.tokenEnv) {
    const token = env[source.tokenEnv];
    if (!token) throw Error('私有更新源授权未配置，请由助手协助使用本人凭据');
    if (/\s/.test(token)) throw Error('私有更新源授权格式无效');
    headers.Authorization = `Bearer ${token}`;
  }
  if (new URL(source.baseUrl).hostname === 'api.github.com') headers.Accept = 'application/vnd.github.raw+json';
  const download = async name => {
    validateDownloadName(name);
    const response = await request(new URL(name, source.baseUrl), {signal: AbortSignal.timeout(12000), redirect: 'error', headers});
    if (!response.ok) throw Error(`更新服务返回 HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > 2_000_000) throw Error('更新文件过大');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2_000_000) throw Error('更新文件过大');
    return bytes;
  };
  download.sourceId = digest(JSON.stringify(source));
  return download;
}
export async function checkUpdate(root, {data = dataDirectory(), download} = {}) {
  const current = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
  try {
    download ||= sourceDownloader(await loadUpdateSource(data));
    const bytes = await download('release.json'), release = validateRelease(JSON.parse(bytes));
    const status = compareVersions(release.version, current) > 0 ? 'available' : 'current';
    const result = {status, current, latest: release.version, notes: release.notes || [], checkedAt: new Date().toISOString(), manifestHash: digest(bytes), sourceId: download.sourceId || 'injected', release};
    await saveJSON(path.join(data, 'updates', digest(path.resolve(root)).slice(0, 16) + '.json'), result);
    return {...result, release: undefined};
  } catch (error) {
    const source = await loadUpdateSource(data).catch(() => null);
    return {status: 'unavailable', current, ...(source ? {releaseSource: source.baseUrl, connectorFallback: true} : {}), message: `本次未能检查云端更新：${error.message}；可通过客户端网络工具检查，或继续使用当前版本。`};
  }
}
export async function verifySource(root, release) {
  validateRelease(release);
  for (const [name, hash] of Object.entries(release.files)) {
    const file = path.join(root, name), stat = await fs.lstat(file);
    if (!stat.isFile() || digest(await fs.readFile(file)) !== hash) throw Error(`发布文件校验失败：${name}`);
  }
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'li-auto-event-tracking' || pkg.version !== release.version || !/^\d+\.\d+\.\d+$/.test(pkg.dependencies?.playwright || '')) throw Error('发布版本或依赖声明异常');
  return pkg;
}
export async function ensureDependencies(stage, previous) {
  const expected = JSON.parse(await fs.readFile(path.join(stage, 'package.json'), 'utf8')).dependencies.playwright;
  const candidates = [previous && path.join(previous, 'node_modules'), path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean);
  for (const modules of candidates) {
    const actual = await fs.realpath(modules).catch(() => null);
    // A real directory inside the old installation would move during replacement.
    if (!actual || (previous && actual.startsWith(path.resolve(previous) + path.sep))) continue;
    const pkg = await fs.readFile(path.join(actual, 'playwright/package.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (pkg?.version === expected) {
      await fs.symlink(actual, path.join(stage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      return;
    }
  }
  await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {cwd: stage, stdio: ['ignore', 'ignore', 'pipe'], shell: process.platform === 'win32'});
    child.stderr.resume();
    child.on('error', () => reject(Error('缺少 npm，无法准备脚本依赖；请由助手配置 Node.js 20+')));
    child.on('exit', code => code === 0 ? resolve() : reject(Error('脚本依赖安装失败；原版本保留')));
  });
  const require = createRequire(path.join(stage, 'package.json'));
  if (require('playwright/package.json').version !== expected) throw Error('Playwright 版本校验失败');
}
export async function installSource(source, destination, {prepareDependencies = ensureDependencies, data = dataDirectory()} = {}) {
  const release = validateRelease(JSON.parse(await fs.readFile(path.join(source, 'release.json'), 'utf8')));
  await verifySource(source, release);
  const resolved = path.resolve(destination);
  if (await fs.lstat(resolved).then(s => s.isSymbolicLink()).catch(() => false)) throw Error('技能目录为符号链接，请先确认实际安装目录');
  const config = await fs.readFile(path.join(data, 'config.json'), 'utf8').then(JSON.parse).catch(error => {if (error.code === 'ENOENT') return {}; throw error;});
  const stateDirectory = config.stateDir || path.join(data, 'state');
  await fs.mkdir(stateDirectory, {recursive: true, mode: 0o700});
  const operationLockPath = path.join(stateDirectory, 'run.lock');
  await fs.mkdir(path.dirname(resolved), {recursive: true});
  const lockPath = resolved + '.update.lock';
  const lock = await fs.open(lockPath, 'wx', 0o600).catch(() => {throw Error('此技能正在安装或更新，请稍后重试');});
  const stage = path.join(path.dirname(resolved), '.li-auto-event-tracking.staging-' + randomUUID());
  const backup = path.join(data, 'skill-backups', digest(resolved).slice(0, 16), Date.now() + '-' + randomUUID());
  let moved = false, operationLock;
  try {
    operationLock = await fs.open(operationLockPath, 'wx', 0o600).catch(() => {throw Error('已有埋点操作运行中，完成后再更新');});
    await fs.mkdir(stage, {mode: 0o700});
    for (const name of [...Object.keys(release.files), 'release.json']) {
      await fs.mkdir(path.dirname(path.join(stage, name)), {recursive: true});
      await fs.copyFile(path.join(source, name), path.join(stage, name));
    }
    await verifySource(stage, release);
    await prepareDependencies(stage, resolved);
    await saveJSON(path.join(stage, '.installation.json'), {version: release.version, source: 'verified-local-package', installedAt: new Date().toISOString()});
    if (await exists(resolved)) {await fs.mkdir(path.dirname(backup), {recursive: true, mode: 0o700}); await fs.rename(resolved, backup); moved = true;}
    try {await fs.rename(stage, resolved);} catch (error) {if (moved) await fs.rename(backup, resolved); throw error;}
    return {status: 'installed', version: release.version, destination: resolved, ...(moved ? {backup} : {})};
  } finally {
    await fs.rm(stage, {recursive: true, force: true});
    if (operationLock) {await operationLock.close(); await fs.unlink(operationLockPath);}
    await lock.close(); await fs.unlink(lockPath);
  }
}
export async function applyUpdate(root, {version, confirmed, data = dataDirectory(), download, install = installSource} = {}) {
  if (!confirmed || !version) throw Error('先展示更新内容并取得使用者确认，再指定 --version 和 --confirmed');
  const receipt = await fs.readFile(path.join(data, 'updates', digest(path.resolve(root)).slice(0, 16) + '.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (!receipt || receipt.status !== 'available' || receipt.latest !== version) throw Error('该版本尚未检查，请先检查并确认更新');
  download ||= sourceDownloader(await loadUpdateSource(data));
  if (receipt.sourceId !== (download.sourceId || 'injected')) throw Error('更新源已变化，请重新检查并确认；本次未更新');
  const installed = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
  if (compareVersions(version, installed) <= 0) throw Error('当前已安装相同或更新版本，无需替换');
  const bytes = await download('release.json');
  if (digest(bytes) !== receipt.manifestHash) throw Error('云端版本已变化，请重新检查并确认；本次未更新');
  const release = validateRelease(JSON.parse(bytes));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'li-auto-update-'));
  try {
    for (const [name, hash] of Object.entries(release.files)) {
      const content = await download(name);
      if (digest(content) !== hash) throw Error(`更新文件校验失败：${name}；原版本保留`);
      await fs.mkdir(path.dirname(path.join(temp, name)), {recursive: true});
      await fs.writeFile(path.join(temp, name), content);
    }
    await fs.writeFile(path.join(temp, 'release.json'), bytes);
    return await install(temp, root, {data});
  } finally {await fs.rm(temp, {recursive: true, force: true});}
}
