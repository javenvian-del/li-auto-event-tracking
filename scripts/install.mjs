import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {installSource} from './lib/distribution.mjs';
const args = process.argv.slice(2);
const option = name => {const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1];};
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = option('--target') || 'both';
const targets = {
  codex: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills/li-auto-event-tracking'),
  claude: path.join(os.homedir(), '.claude/skills/li-auto-event-tracking'),
  agents: path.join(os.homedir(), '.agents/skills/li-auto-event-tracking')
};
try {
  const selected = option('--dest') ? [path.resolve(option('--dest'))] : target === 'both' ? [targets.codex, targets.claude] : targets[target] ? [targets[target]] : null;
  if (!selected) throw Error('安装目标：--target both|codex|claude|agents，或 --dest 自定义技能目录');
  for (const destination of selected) console.log(JSON.stringify(await installSource(root, destination)));
  console.log('安装完成。在能执行本机命令的 AI 对话中，发送“使用理想汽车埋点技能”和 PRD 或表格链接。首次使用助手会检查环境并说明用法。');
} catch (error) {console.error(error.message); process.exitCode = 1;}
