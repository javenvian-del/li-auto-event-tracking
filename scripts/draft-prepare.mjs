import path from 'node:path';
import {prepareDraft} from './lib/draft.mjs';
import {loadConfig, withBrowser, pageURL} from './lib/runtime.mjs';
import {PageCatalog} from './lib/page-catalog.mjs';
import {Platform} from './lib/platform.mjs';
const args = process.argv.slice(2), option = name => {const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1];};
try {
  if (!option('--manifest') || !option('--output')) throw Error('需要 --manifest 草稿.json 和 --output 本地输出目录');
  const config = await loadConfig();
  pageURL(config);
  const result = await withBrowser(config, async context => {
    const page = await context.newPage();
    await page.goto(config.platformUrl, {waitUntil: 'domcontentloaded'});
    const platform = new Platform(page);
    let catalog;
    const lookup = async (app, name, directory) => {
      if (!catalog) {catalog = new PageCatalog(await context.newPage(), config); await catalog.ready();}
      return catalog.download(app, name, directory);
    };
    return prepareDraft(path.resolve(option('--manifest')), path.resolve(option('--output')), lookup, {findEvent: row => platform.findExisting(row)});
  });
  console.log(JSON.stringify(result)); if (result.status !== 'ready') process.exitCode = 1;
} catch (error) {console.error(error.message); process.exitCode = 1;}
