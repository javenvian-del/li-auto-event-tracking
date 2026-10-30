import fs from 'node:fs/promises';
import path from 'node:path';
import {digest} from './distribution.mjs';
import {pageURL} from './runtime.mjs';
const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export class PageCatalog {
  constructor(page, config) {this.p = page; this.config = config;}
  async ready() {
    await this.p.goto(pageURL(this.config), {waitUntil: 'domcontentloaded'});
    await this.p.getByRole('textbox', {name: '请选择应用', exact: true}).waitFor({timeout: 20000}).catch(() => {throw Error('运营平台未就绪，请检查公司网络与本人登录状态');});
  }
  async settle() {await this.p.waitForLoadState('networkidle', {timeout: 20000}); await this.p.locator('.el-loading-mask:visible').waitFor({state: 'hidden', timeout: 20000});}
  async close() {
    const button = this.p.getByRole('button', {name: /^close /});
    if (await button.count()) {await button.click(); await this.p.getByRole('dialog').waitFor({state: 'hidden'});}
  }
  async find(appName, pageName) {
    await this.close();
    const app = this.p.getByRole('textbox', {name: '请选择应用', exact: true});
    if (await app.inputValue() !== appName) {
      await app.click();
      const item = this.p.getByRole('listitem').filter({hasText: new RegExp(`^${escaped(appName)}$`)});
      await item.first().waitFor({timeout: 10000});
      if (await item.count() !== 1) throw Error(`应用无法唯一匹配：${appName}`);
      await item.click(); await this.settle();
    }
    await this.p.getByRole('textbox', {name: '页面名称、路径或标识', exact: true}).fill(pageName);
    const query = this.p.getByRole('button', {name: /查询/});
    if (await query.count() !== 1) throw Error('页面查询入口发生变化');
    await query.click(); await this.settle();
    const cells = this.p.getByRole('cell', {name: pageName, exact: true});
    if (await cells.count() !== 1) throw Error(`页面未唯一精确匹配，需人工核对：${appName} / ${pageName}`);
    const row = cells.locator('..');
    if (await row.getByRole('cell', {name: appName, exact: true}).count() !== 1) throw Error('匹配页面所属应用不一致');
    const id = (await row.innerText()).match(/\bp_[A-Za-z0-9]+\b/)?.[0];
    if (!id) throw Error('未找到页面标识');
    return {app: appName, name: pageName, id, cell: cells};
  }
  async download(app, name, directory) {
    const match = await this.find(app, name);
    await match.cell.click();
    const dialog = this.p.getByRole('dialog');
    await dialog.getByText('图片信息', {exact: true}).click();
    const images = dialog.locator('img');
    await images.first().waitFor({state: 'visible', timeout: 15000}).catch(() => {throw Error(`平台页面没有可用截图：${app} / ${name}`);});
    if (await images.count() !== 1) throw Error(`平台页面有多张图片，需要确认使用哪一张：${app} / ${name}`);
    const src = await images.first().evaluate(async image => {await image.decode(); if (!image.naturalWidth) throw Error('图片未加载'); return image.currentSrc || image.src;});
    const url = new URL(src, this.p.url());
    const allowed = url.hostname === 'p.ampmake.com' || url.origin === new URL(this.config.platformUrl).origin || url.hostname.endsWith('.chehejia.com');
    if (url.protocol !== 'https:' || !allowed) throw Error('页面图片使用了未验证的下载域名，请先核对来源');
    const response = await this.p.context().request.get(url.href, {timeout: 30000, maxRedirects: 0});
    if (!response.ok()) throw Error(`页面截图下载失败：HTTP ${response.status()}`);
    const bytes = await response.body();
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if ((!png && !jpg) || bytes.length > 20_000_000) throw Error('平台截图不是可用的 JPG/PNG 或图片过大');
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const file = path.join(directory, digest(`${app}\n${name}\n${match.id}`).slice(0, 20) + (png ? '.png' : '.jpg'));
    await fs.writeFile(file, bytes, {mode: 0o600});
    await this.close();
    return {source: 'platform', path: file, pageId: match.id, app, page: name, retrievedAt: new Date().toISOString()};
  }
}
