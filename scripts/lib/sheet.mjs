import {mkdir,access,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fields,headers,normalize,fingerprint,hashImage} from './core.mjs';
const mod=process.platform==='darwin'?'Meta':'Control';
export class Sheet {
  constructor(page,config,dir) {this.p=page;this.c=config;this.dir=dir;}
  async select(cell) {
    const box=this.p.getByRole('main').getByRole('textbox');
    // Retry navigation only: pending Tab/selection updates may replace the name box.
    for(let attempt=0;attempt<3;attempt++) {
      await this.p.keyboard.press('Escape');
      await box.fill(cell); await box.press('Enter');
      await this.p.waitForTimeout(700);
      if(await box.inputValue()===cell) return;
    }
    throw Error(`无法定位单元格${cell}`);
  }

  async read(cell) {
    await this.select(cell);
    const bar=this.p.locator('.formulabar__inputarea:visible');
    await bar.waitFor({state:'attached'});
    let previous=(await bar.innerText()).trim();
    for(let i=0;i<10;i++) {
      await this.p.waitForTimeout(300);
      const current=(await bar.innerText()).trim();
      if(current===previous) return current;
      previous=current;
    }
    throw Error(`单元格${cell}内容未稳定，停止读取`);
  }
  async ready() {
    await this.p.getByRole('main').getByRole('textbox').waitFor({timeout:180000});
    await this.p.getByText(this.c.sheetName,{exact:true}).click();
    for(const [k,col] of Object.entries(this.c.columns)) {
      const h=await this.read(`${col}1`);
      if(['eventName','eventId'].includes(k)&&!h) continue;
      if(h!==headers[k]) throw Error(`${col}1应为“${headers[k]}”，实际为“${h}”；请调整列映射`);
    }
  }
  async row(n) {
    const r={row:n};
    for(const k of [...fields,'eventName','eventId']) r[k]=await this.read(`${this.c.columns[k]}${n}`);
    const override=this.c.elementOverrides?.[n];
    if(override){
      if(r.element!==override.source) throw Error(`第${n}行原始元素名称已变化，停止使用已批准的修正`);
      r.sourceElement=r.element;r.element=override.value;
    }
    return normalize(r);
  }
  async image(row) {
    const explicit=this.c.images?.[row.row];
    if(explicit) {const file=path.resolve(explicit);await access(file);return file;}
    await this.select(`${this.c.columns.image}${row.row}`);
    const menu=this.p.locator('.option-paste:visible').filter({has:this.p.locator('svg[data-icon="AlbumOutlined"]')});
    await menu.waitFor({timeout:5000}).catch(()=>{throw Error(`第${row.row}行图片菜单不可用；请将原图文件路径填入config.json的images.${row.row}`);});
    await menu.locator('.option-paste-icons').click();
    const promise=this.p.waitForEvent('download',{timeout:20000});
    await this.p.getByText('下载图片',{exact:true}).click();
    const dl=await promise;
    let ext=path.extname(dl.suggestedFilename()).toLowerCase();
    if(!['.png','.jpg','.jpeg'].includes(ext)) throw Error(`不支持的图片格式：${ext}`);
    await mkdir(this.dir,{recursive:true});
    const dest=path.join(this.dir,`row-${row.row}-${fingerprint(row).slice(0,12)}${ext}`);
    // Chrome 153 crashes while saving this Feishu attachment. Keep native saving
    // disabled; the normal UI permission check still yields the download URL.
    const url=new URL(dl.url());
    if(url.protocol!=='https:'||!url.hostname.endsWith('.feishu.cn')) throw Error('图片下载地址超出飞书范围');
    const response=await this.p.context().request.get(url.href,{timeout:30000,maxRedirects:0});
    if(!response.ok()) throw Error(`图片下载失败：HTTP ${response.status()}`);
    const bytes=await response.body();
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!png&&!jpg) throw Error('下载结果不是PNG/JPG图片，停止');
    await writeFile(dest,bytes,{mode:0o600});
    return dest;
  }
  async assertUnchanged(row) {
    const fresh=await this.row(row.row);
    if(fingerprint(fresh)!==fingerprint(row)) throw Error('源表格行内容发生变化，停止执行');
    for(const k of ['eventName','eventId']) if(fresh[k]&&fresh[k]!==row[k]) throw Error('结果列发生变化，停止覆盖');
    if(row.imageHash){
      const freshImage=await this.image(row),freshHash=await hashImage(freshImage);
      if(freshHash!==row.imageHash) throw Error('事件截图发生变化，停止执行并重新预检');
    }
  }
  async writeCell(cell,value) {
    await this.select(cell); await this.p.keyboard.press('F2');
    await this.p.keyboard.press(`${mod}+A`); await this.p.keyboard.insertText(value);
    await this.p.keyboard.press('Tab');
    await this.p.waitForTimeout(300);
    if(await this.read(cell)!==value) throw Error(`回写${cell}后核对失败`);
    await this.p.getByText('已经保存到云端',{exact:true}).waitFor({timeout:30000});
  }
  async writeResult(row,record) {
    const fresh=await this.row(row.row);
    if(fingerprint(fresh)!==fingerprint(row)) throw Error('源行发生变化，保留本地结果，不回写');
    for(const k of ['eventName','eventId']) {
      const col=this.c.columns[k], h=await this.read(`${col}1`);
      if(h&&h!==headers[k]) throw Error(`目标列${col}已有其他标题，停止覆盖`);
      if(fresh[k]&&fresh[k]!==record[k]) throw Error(`目标行${headers[k]}已有不同内容，停止覆盖`);
    }
    for(const k of ['eventName','eventId']) {
      const col=this.c.columns[k];
      if(!await this.read(`${col}1`)) await this.writeCell(`${col}1`,headers[k]);
      if(fresh[k]!==record[k]) await this.writeCell(`${col}${row.row}`,record[k]);
    }
  }
}
