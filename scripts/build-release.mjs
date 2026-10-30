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
  '统一首次使用介绍：明确在用户增长运营中心快速批量创建埋点，并自动回写事件名称和事件标识。',
  '按核心功能、怎么使用、使用前准备三段展示；已看过旧介绍的用户升级后补展示一次。',
  '每次调用检查云端版本，使用者确认后更新；保留本机配置和登录状态。'
], files: Object.fromEntries(Object.entries(files).sort())});
await fs.writeFile(path.join(root, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify({version: pkg.version, files: Object.keys(files).length}));
