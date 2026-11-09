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
  '首次使用请使用者提供平台事件管理页网址，并明确说明：为避免系统地址泄漏，网址配置只保存在本机，不随技能公开发布。',
  '移除公开代码中的公司和图片服务域名；平台与图片来源从本机配置读取，继续进行 HTTPS、同源及图片下载校验。',
  '已有平台配置自动复用；额外图片来源确认一次后仅在本机保存，安装命令和确认后更新机制保持不变。',
  '保留已有事件整行标黄、中文标记、自定义属性要求列，以及完整介绍和 Chrome 启动前权限检查。'
], files: Object.fromEntries(Object.entries(files).sort())});
await fs.writeFile(path.join(root, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify({version: pkg.version, files: Object.keys(files).length}));
