import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tracking-browser-permission-')));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  await fs.cp(path.join(root, 'scripts'), path.join(dir, 'scripts'), {recursive: true});
  const modules = path.join(dir, 'node_modules/playwright');
  await fs.mkdir(modules, {recursive: true});
  await fs.writeFile(path.join(modules, 'package.json'), JSON.stringify({name: 'playwright', type: 'module', exports: './index.mjs'}));
  // Trap the real launch seam without starting Chrome or visiting a business page.
  await fs.writeFile(path.join(modules, 'index.mjs'), `import fs from 'node:fs/promises';
export const chromium={async launchPersistentContext(){
 await fs.writeFile(process.env.TRACKING_TEST_LAUNCH_MARKER,'attempted');
 return {async newPage(){throw Error('TEST_BROWSER_STUB');},pages(){return [];},async close(){}};
}};`);
  const data = path.join(dir, 'data'), state = path.join(dir, 'state'), marker = path.join(dir, 'launched');
  await fs.mkdir(data);
  const config = {sheetUrl: 'https://example.feishu.cn/sheets/example', sheetName: '埋点', platformUrl: 'https://example.chehejia.com/Elnav/event', rows: [2], stateDir: state, columns: {app: 'A', page: 'B', element: 'C', action: 'D', developer: 'E', tester: 'F', description: 'G', image: 'H', eventName: 'I', eventId: 'J'}};
  const configPath = path.join(data, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  const picture = path.join(dir, 'page.png');
  await fs.writeFile(picture, Buffer.from([137,80,78,71,13,10,26,10]));
  const manifest = path.join(dir, 'pages.json');
  await fs.writeFile(manifest, JSON.stringify({pages: [{app: '应用', name: '页面', description: '测试页面', imagePath: picture}]}));
  const run = (script, args = []) => spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args], {
    env: {...process.env, CODEX_SANDBOX: 'seatbelt', LI_AUTO_TRACKING_DATA: data, TRACKING_TEST_LAUNCH_MARKER: marker}, encoding: 'utf8', timeout: 5000
  });
  return {dir, data, state, marker, config, configPath, manifest, run};
}

test('macOS restricted execution stops every Chrome entry before launch or run-state changes', {skip: process.platform !== 'darwin'}, async t => {
  const x = await fixture(t);
  const calls = [
    ['session.mjs', ['--config', x.configPath]],
    ['run.mjs', ['--login', '--config', x.configPath]],
    ['batch.mjs', ['--check', '--config', x.configPath]],
    ['page-batch.mjs', ['--check', '--manifest', x.manifest, '--config', x.configPath]],
    ...['check-login', 'login', 'events-check', 'run', 'pages-check', 'pages-run', 'check-platform', 'platform-login'].map(command => ['control.mjs', [command, '--rows', '2', '--confirmed', '--manifest', x.manifest]])
  ];
  for (const [script, args] of calls) {
    const result = x.run(script, args);
    assert.equal(await fs.stat(x.marker).catch(() => null), null, `${script} attempted Chrome launch before permission was obtained`);
    assert.match(result.stderr, /BROWSER_EXECUTION_PERMISSION_REQUIRED/, script);
    assert.notEqual(result.status, 0, script);
    assert.equal(await fs.stat(x.state).catch(() => null), null, `${script} changed run state before permission was obtained`);
    assert.equal(await fs.stat(path.join(x.data, 'last-run.json')).catch(() => null), null);
  }
});

test('the shared browser path rejects restricted execution before invoking its callback', {skip: process.platform !== 'darwin'}, async t => {
  const x = await fixture(t);
  await fs.writeFile(path.join(x.dir, 'scripts/probe.mjs'), `import {withBrowser} from './lib/runtime.mjs';
await withBrowser(${JSON.stringify(x.config)}, async()=>{throw Error('CALLBACK_MUST_NOT_RUN');});`);
  const result = x.run('probe.mjs');
  assert.equal(await fs.stat(x.marker).catch(() => null), null, 'shared helper attempted Chrome launch');
  assert.match(result.stderr, /BROWSER_EXECUTION_PERMISSION_REQUIRED/);
  assert.equal(await fs.stat(x.state).catch(() => null), null);
});
