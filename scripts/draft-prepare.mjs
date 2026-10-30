import path from 'node:path';
import {prepareDraft} from './lib/draft.mjs';
import {loadConfig, withBrowser} from './lib/runtime.mjs';
import {PageCatalog} from './lib/page-catalog.mjs';
const args = process.argv.slice(2), option = name => {const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1];};
let resolveRequest, finished, browserTask;
const queue = [];
// Keep one browser session for the batch; do not start one when all PRD images exist.
async function lookup(app, page, directory) {
  if (!browserTask) {
    browserTask = loadConfig().then(config => withBrowser(config, async context => {
      const catalog = new PageCatalog(await context.newPage(), config); await catalog.ready();
      while (!finished) {
        const request = queue.shift() || await new Promise(resolve => {resolveRequest = resolve;});
        if (!request) break;
        try {request.resolve(await catalog.download(request.app, request.page, request.directory));}
        catch (error) {request.reject(error);}
      }
    }));
    browserTask.catch(error => {finished = error; for (const r of queue.splice(0)) r.reject(error);});
  }
  if (finished instanceof Error) throw finished;
  return new Promise((resolve, reject) => {
    const request = {app, page, directory, resolve, reject};
    if (resolveRequest) {const next = resolveRequest; resolveRequest = null; next(request);} else queue.push(request);
  });
}
try {
  if (!option('--manifest') || !option('--output')) throw Error('需要 --manifest 草稿.json 和 --output 本地输出目录');
  const result = await prepareDraft(path.resolve(option('--manifest')), path.resolve(option('--output')), lookup);
  console.log(JSON.stringify(result)); if (result.status !== 'ready') process.exitCode = 1;
} catch (error) {console.error(error.message); process.exitCode = 1;}
finally {finished = true; resolveRequest?.(null); await browserTask?.catch(() => {});}
