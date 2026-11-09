import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(t) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'tracking-intro-test-'));
  t.after(() => fs.rm(data, {recursive: true, force: true}));
  const stateFile = path.join(data, 'onboarding.json');
  const previousState = JSON.stringify({guideVersion: 2, shownAt: '2026-01-01T00:00:00.000Z'});
  await fs.writeFile(stateFile, previousState);
  const run = async (...args) => {
    const {stdout} = await exec(process.execPath, [path.join(root, 'scripts/control.mjs'), ...args], {
      env: {...process.env, LI_AUTO_TRACKING_DATA: data}
    });
    return JSON.parse(stdout);
  };
  return {run, data, stateFile, previousState};
}

test('an old seen marker and a premature acknowledgement cannot suppress the next introduction', async t => {
  const x = await fixture(t);
  await x.run('guide-seen');
  const result = await x.run('start', '--downloaded-source', root);
  assert.equal(result.guideNeeded, true, 'explicit skill invocation must include the introduction despite old seen state');
  assert.equal(typeof result.introduction, 'string');
  assert.equal(result.introduction, await fs.readFile(path.join(root, 'references/introduction.md'), 'utf8'));
  assert.equal(await fs.readFile(x.stateFile, 'utf8'), x.previousState, 'legacy acknowledgement must not mark unseen content as read');
});

test('continuing a task skips the introduction for that call without hiding it from a new invocation', async t => {
  const x = await fixture(t);
  const continuation = await x.run('start', '--continue', '--downloaded-source', root);
  assert.equal(continuation.guideNeeded, false);
  assert.equal(continuation.introduction, undefined);
  const next = await x.run('start', '--downloaded-source', root);
  assert.equal(next.guideNeeded, true);
  assert.ok(next.introduction);
});

test('the introduction can be read offline without changing personal state', async t => {
  const x = await fixture(t);
  const result = await x.run('intro');
  assert.equal(result.guideNeeded, true);
  assert.equal(result.introduction, await fs.readFile(path.join(root, 'references/introduction.md'), 'utf8'));
  assert.equal(await fs.readFile(x.stateFile, 'utf8'), x.previousState);
  assert.deepEqual(await fs.readdir(x.data), ['onboarding.json']);
});
