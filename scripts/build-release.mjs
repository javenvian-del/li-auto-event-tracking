import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest, validateRelease} from './lib/distribution.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const files = {};
async function walk(folder = '') {
  for (const item of await fs.readdir(path.join(root, folder), {withFileTypes: true})) {
    const name = path.posix.join(folder, item.name);
    if (item.name.startsWith('.') || ['node_modules', 'release.json'].includes(item.name)) continue;
    if (item.isDirectory()) {if (['scripts', 'references', 'agents', 'test'].includes(name) || folder) await walk(name);}
    else if (item.isFile()) files[name] = digest(await fs.readFile(path.join(root, name)));
    else throw Error(`发布包不得包含符号链接：${name}`);
  }
}
await walk();
const release = validateRelease({schemaVersion: 1, version: pkg.version, notes: [
  '独立技能代码仓库支持免 GitHub 登录的一条命令安装，自动准备本机运行环境。',
  '每次调用检查云端版本，使用者确认后更新；保留本机配置和登录状态。',
  '兼容 PRD 已有埋点表、无埋点表及缺少截图；PRD 图片优先，缺图时从平台精确匹配页面补齐。',
  '新增首次使用指南和环境检查，支持 Codex、Claude Code 及其他具备本机执行能力的 AI 客户端。'
], files: Object.fromEntries(Object.entries(files).sort())});
await fs.writeFile(path.join(root, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify({version: pkg.version, files: Object.keys(files).length}));
