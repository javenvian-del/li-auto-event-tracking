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
  '修复介绍被提前标记为已读后一直跳过的问题；启动结果直接提供完整介绍，首次对话、只说技能名或升级后原样展示。',
  '介绍补充脚本与 AI 分工：脚本执行本身不消耗模型 token，AI 理解需求、对话和工具结果解读仍有用量。',
  '每次调用检查云端版本，使用者确认后更新；保留本机配置和登录状态。'
], files: Object.fromEntries(Object.entries(files).sort())});
await fs.writeFile(path.join(root, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify({version: pkg.version, files: Object.keys(files).length}));
