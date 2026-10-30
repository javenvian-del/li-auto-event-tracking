import {actions,verifyRecord} from './core.mjs';
export class Platform {
  constructor(page) {this.p=page;}
  async clickOne(locator,label) {
    if(await locator.count()!==1) throw Error(`${label}按钮数量异常，停止操作`);
    await locator.click();
  }
  async settle() {
    await this.p.waitForLoadState('networkidle',{timeout:20000});
    await this.p.locator('.el-loading-mask:visible').waitFor({state:'hidden',timeout:20000});
  }
  async choose(scope,placeholder,text) {
    await scope.getByRole('textbox',{name:placeholder,exact:true}).click();
    await this.p.getByRole('listitem').filter({hasText:new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)}).click();
    await this.settle();
  }
  async close() {
    const btn=this.p.getByRole('button',{name:/^close /});
    if(await btn.count()) {await btn.click();await this.p.getByRole('dialog').waitFor({state:'hidden'});}
  }
  async find(row,query,{verify=true}={}) {
    const records=await this.findAll(row,query,verify?1:Infinity,verify);
    return records[0]??null;
  }
  async findAll(row,query,max=2,verify=true) {
    await this.close();
    const app=this.p.getByRole('textbox',{name:'请选择应用',exact:true});
    await app.waitFor({timeout:20000}).catch(()=>{throw Error('平台应用选择框未就绪，请检查登录状态或页面结构');});
    if(await app.inputValue()!==row.app) await this.choose(this.p,'请选择应用',row.app);
    await this.p.getByRole('textbox',{name:'查询事件名称或标识',exact:true}).fill(query);
    await this.clickOne(this.p.getByRole('button',{name:/查询/}),'查询'); await this.settle();
    const match=this.p.getByRole('cell',{name:row.expectedName,exact:true});
    const count=await match.count();
    if(count>max) throw Error(`同名事件数量超出预期：${count}`);
    if(!count) {
      // A search failure must not be mistaken for an empty result.
      const emptyMarkers=await this.p.getByText('暂无数据',{exact:true}).all();
      const visible=await Promise.all(emptyMarkers.map(marker=>marker.isVisible()));
      if(!visible.some(Boolean)) throw Error('查询结果非空但没有精确匹配，停止创建');
      return [];
    }
    const records=[];
    for(let i=0;i<(verify?count:Math.min(count,1));i++) {
    await match.nth(i).click();
    const d=this.p.getByRole('dialog'); await d.getByRole('heading',{name:'事件详情'}).waitFor();
    const get=async label=>{
      const r=d.getByRole('row').filter({has:this.p.getByRole('rowheader',{name:label,exact:true})});
      return (await r.getByRole('cell').innerText()).trim();
    };
    const record={eventName:await get('事件名称'),eventId:await get('标识'),page:await get('所属页面'),element:await get('元素名称'),action:await get('动作类型'),developer:await get('研发负责人'),tester:await get('测试负责人'),description:await get('页面描述')};
    if(verify) verifyRecord(row,record); await this.close(); records.push(record);
    }
    if(new Set(records.map(r=>r.eventId)).size!==records.length) throw Error('查询返回重复标识，停止');
    return records;
  }
  async open(row) {
    await this.close();
    await this.clickOne(this.p.getByRole('button',{name:/创建/}),'创建事件入口');
    this.d=this.p.getByRole('dialog',{name:'新建事件',exact:true});
    await this.d.waitFor();
    await this.choose(this.d,'请选择应用',row.app);
    await this.choose(this.d,'请选择页面',row.page);
    await this.choose(this.d,'请选择动作类型',`${row.action}/${actions[row.action]}`);
    const boxes=this.d.getByRole('textbox');
    if(await boxes.count()!==7) throw Error('创建表单结构变化，停止填写');
  }
  async inspectOptions(row) {try {await this.open(row);} finally {await this.close();}}
  async prepare(row) {
    await this.open(row);
    const boxes=this.d.getByRole('textbox');
    await boxes.nth(2).fill(row.element); await boxes.nth(4).fill(row.developer);
    await boxes.nth(5).fill(row.tester); await boxes.nth(6).fill(row.description);
    const uploaded=this.p.waitForResponse(r=>new URL(r.url()).pathname==='/common/uploadImage'&&r.request().method()==='POST',{timeout:30000});
    // Observe rejection even if selecting the local file itself fails.
    uploaded.catch(()=>{});
    const chooserPromise=this.p.waitForEvent('filechooser');
    await this.d.getByText('点击添加图片支持JPG,PNG图片',{exact:true}).click();
    await (await chooserPromise).setFiles(row.imagePath);
    const response=await uploaded, result=await response.json();
    if(!response.ok()||result.code!==0) throw Error('截图上传失败，停止提交');
    const expected=[row.app,row.page,row.element,`${row.action}/${actions[row.action]}`,row.developer,row.tester,row.description];
    for(let i=0;i<expected.length;i++) if(await boxes.nth(i).inputValue()!==expected[i]) throw Error('提交前字段校验失败');
    // A completed image thumbnail is mandatory. Upload markup can change; fail closed.
    const images=this.d.locator('img');
    await images.first().waitFor({state:'visible',timeout:20000});
    await images.first().evaluate(async img=>{await img.decode();if(!img.complete||img.naturalWidth===0)throw Error('截图解码失败');});
  }
  async submit() {
    await this.clickOne(this.d.getByRole('button',{name:/创建/}),'创建事件提交');
    // Do not click again on timeout; journal stays in submitting state.
    await this.p.getByText('创建成功!',{exact:true}).waitFor({timeout:20000});
    await this.d.waitFor({state:'hidden',timeout:20000}); await this.settle();
  }
}
