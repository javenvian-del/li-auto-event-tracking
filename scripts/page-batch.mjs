import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {hashImage,validateConfig} from './lib/core.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('node page-batch.mjs (--check | --create) --manifest pages.json --config config.json');
  process.exit(0);
}
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
const mode=args.includes('--create')?'create':args.includes('--check')?'check':null;
if(!mode||args.filter(x=>x==='--check'||x==='--create').length!==1)throw Error('必须且只能指定 --check 或 --create');
const manifestPath=path.resolve(option('--manifest')??'');
const configPath=path.resolve(option('--config')??'');
if(!option('--manifest')||!option('--config'))throw Error('需要 --manifest 和 --config');

const config=JSON.parse(await fs.readFile(configPath,'utf8'));validateConfig(config);
const raw=JSON.parse(await fs.readFile(manifestPath,'utf8').catch(()=>{throw Error('无法读取页面清单');}));
if(!Array.isArray(raw.pages)||!raw.pages.length)throw Error('页面清单必须包含非空 pages 数组');
const base=path.dirname(manifestPath),seen=new Set(),pages=[];
for(const [index,item] of raw.pages.entries()){
  const page={
    app:String(item?.app??'').trim(),
    name:String(item?.name??'').trim(),
    description:String(item?.description??'').trim(),
    imagePath:path.resolve(base,String(item?.imagePath??''))
  };
  if(page.app.toLowerCase()==='理想汽车app')page.app='理想汽车APP';
  if(!page.app||!page.name||!page.description||!item?.imagePath)throw Error(`第${index+1}个页面缺少应用、名称、描述或截图`);
  if(page.name.length>30)throw Error(`页面名称超过30字：${page.name}`);
  if(page.description.length>200)throw Error(`页面描述超过200字：${page.name}`);
  if(!/\.(?:jpe?g|png)$/i.test(page.imagePath))throw Error(`页面截图必须是JPG或PNG：${page.name}`);
  const stat=await fs.stat(page.imagePath).catch(()=>null);
  if(!stat?.isFile())throw Error(`找不到页面截图：${page.imagePath}`);
  const key=`${page.app}\n${page.name}`;
  if(seen.has(key))throw Error(`页面清单存在重复项：${page.app} / ${page.name}`);
  seen.add(key);
  page.imageHash=await hashImage(page.imagePath);
  page.hash=createHash('sha256').update(JSON.stringify([page.app,page.name,page.description,page.imageHash])).digest('hex');
  pages.push(page);
}
const manifestHash=createHash('sha256').update(JSON.stringify(pages.map(x=>x.hash))).digest('hex');

const local=path.resolve(config.stateDir||path.join(root,'.local'));
const pageUrl=(()=>{
  const eventUrl=new URL(config.platformUrl),u=config.pagePlatformUrl?new URL(config.pagePlatformUrl):new URL(config.platformUrl);
  if(u.origin!==eventUrl.origin)throw Error('页面管理地址必须与事件管理地址属于同一运营平台');
  if(config.pagePlatformUrl){if(!/\/page\/?$/.test(u.pathname))throw Error('pagePlatformUrl 必须指向页面管理页');return u.href}
  if(!/\/event\/?$/.test(u.pathname))throw Error('运营平台事件页地址无法推导页面管理地址，请在配置中填写 pagePlatformUrl');
  u.pathname=u.pathname.replace(/\/event\/?$/,'/page');
  u.search='';u.hash='';
  return u.href;
})();
await fs.mkdir(path.join(local,'pages'),{recursive:true,mode:0o700});
const lockPath=path.join(local,'run.lock');
let lock;
try{lock=await fs.open(lockPath,'wx',0o600);}catch{throw Error('已有页面或事件批次正在运行；请等待完成后重试');}
const journalPath=path.join(local,'pages','journal.json'),planPath=path.join(local,'pages','checked.json');
const failurePath=path.join(local,'pages','failure.png');
const readJournal=async()=>JSON.parse(await fs.readFile(journalPath,'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));
const atomic=async(file,value)=>{await fs.writeFile(`${file}.tmp`,JSON.stringify(value,null,2),{mode:0o600});await fs.rename(`${file}.tmp`,file)};
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
let context,platformPage;
try{
  if(mode==='create'){
    const checked=JSON.parse(await fs.readFile(planPath,'utf8').catch(()=>{throw Error('页面清单尚未完成只读预检，请先运行 pages-check')}));
    if(checked.hash!==manifestHash)throw Error('页面清单在预检后发生变化，请重新运行 pages-check');
  }
  let pw;
  try{pw=await import('playwright');}catch{pw=await import(pathToFileURL(path.join(process.env.HOME,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href)}
  context=await pw.chromium.launchPersistentContext(path.join(local,'browser-profile'),{channel:config.channel||'chrome',headless:true,acceptDownloads:false,viewport:{width:1440,height:1000}});
  platformPage=await context.newPage();
  await platformPage.goto(pageUrl,{waitUntil:'domcontentloaded'});
  const settle=async()=>{await platformPage.locator('.el-loading-mask:visible').waitFor({state:'hidden',timeout:20000})};
  const choose=async(scope,placeholder,value)=>{
    await scope.getByRole('textbox',{name:placeholder,exact:true}).click();
    const item=platformPage.getByRole('listitem').filter({hasText:new RegExp(`^${escapeRegExp(value)}$`)});
    if(await item.count()!==1)throw Error(`平台中无法唯一选择：${value}`);
    await item.click();await settle();
  };
  const clickOne=async(locator,label)=>{if(await locator.count()!==1)throw Error(`${label}按钮数量异常，停止操作`);await locator.click()};
  const find=async row=>{
    const app=platformPage.getByRole('textbox',{name:'请选择应用',exact:true});
    await app.waitFor({timeout:20000}).catch(()=>{throw Error('页面管理未就绪，请检查平台登录状态')});
    if(await app.inputValue()!==row.app)await choose(platformPage,'请选择应用',row.app);
    await platformPage.getByRole('textbox',{name:'页面名称、路径或标识',exact:true}).fill(row.name);
    await clickOne(platformPage.getByRole('button',{name:/查询/}),'查询');await settle();
    const cells=platformPage.getByRole('cell',{name:row.name,exact:true}),count=await cells.count();
    if(count>1)throw Error(`同一应用存在多个同名页面：${row.app} / ${row.name}`);
    if(!count){
      const empties=await platformPage.getByText('暂无数据',{exact:true}).all();
      if(!(await Promise.all(empties.map(x=>x.isVisible()))).some(Boolean))throw Error(`页面查询有近似结果但无精确匹配：${row.app} / ${row.name}`);
      return null;
    }
    const text=await cells.locator('..').innerText();
    const id=text.match(/p_[A-Za-z0-9]+/)?.[0];
    if(!id||!text.includes(row.app))throw Error(`页面查询结果的应用或标识不匹配：${row.app} / ${row.name}`);
    return {app:row.app,name:row.name,id};
  };
  const journal=await readJournal(),checked=[],missing=[];
  await settle();
  for(const row of pages){
    const key=`${row.app}|${row.name}`,entry=journal[key];
    if(entry&&entry.hash!==row.hash)throw Error(`页面清单与历史执行记录不一致：${row.app} / ${row.name}`);
    const record=await find(row);
    if(record){
      if(entry&&['submitting','verified'].includes(entry.phase)){
        journal[key]={...entry,phase:'done',record,time:new Date().toISOString()};await atomic(journalPath,journal);
        checked.push({...record,status:'recovered'});
      }else checked.push({...record,status:'existing'});
      continue;
    }
    if(entry)throw Error(`页面有历史提交记录但平台未找到，禁止重复创建：${row.app} / ${row.name}`);
    missing.push(row);checked.push({app:row.app,name:row.name,status:'ready'});
  }
  if(mode==='check')await atomic(planPath,{hash:manifestHash,checkedAt:new Date().toISOString(),pages:checked});
  if(mode==='create'){
    for(const row of missing){
      const key=`${row.app}|${row.name}`;
      if(await hashImage(row.imagePath)!==row.imageHash)throw Error(`页面截图在预检后发生变化：${row.name}`);
      const concurrent=await find(row);
      if(concurrent){const item=checked.find(x=>x.app===row.app&&x.name===row.name);Object.assign(item,concurrent,{status:'existing'});continue}
      await clickOne(platformPage.getByRole('button',{name:/新建/}),'新建页面入口');
      const dialog=platformPage.getByRole('dialog',{name:'新建页面',exact:true});await dialog.waitFor();
      await choose(dialog,'请选择应用',row.app);
      const boxes=dialog.getByRole('textbox'),count=await boxes.count();
      if(![5,6].includes(count))throw Error('新建页面表单结构发生变化，停止填写');
      if(!await boxes.nth(1).inputValue())throw Error('平台未根据应用生成页面分类，停止创建');
      await boxes.nth(2).fill(row.name);await boxes.last().fill(row.description);
      const uploaded=platformPage.waitForResponse(r=>new URL(r.url()).pathname==='/common/uploadImage'&&r.request().method()==='POST',{timeout:30000});uploaded.catch(()=>{});
      const chooser=platformPage.waitForEvent('filechooser');
      await dialog.getByText('点击添加图片支持JPG,PNG图片',{exact:true}).click();
      await (await chooser).setFiles(row.imagePath);
      const response=await uploaded,result=await response.json();
      if(!response.ok()||result.code!==0)throw Error(`页面截图上传失败：${row.name}`);
      const image=dialog.locator('img').first();await image.waitFor({state:'visible',timeout:20000});
      await image.evaluate(async img=>{await img.decode();if(!img.complete||!img.naturalWidth)throw Error('页面截图解码失败')});
      if(await boxes.nth(0).inputValue()!==row.app||await boxes.nth(2).inputValue()!==row.name||await boxes.last().inputValue()!==row.description)throw Error(`页面提交前字段校验失败：${row.name}`);
      journal[key]={phase:'submitting',hash:row.hash,time:new Date().toISOString()};await atomic(journalPath,journal);
      await clickOne(dialog.getByRole('button',{name:/创建/}),'创建页面提交');
      await dialog.waitFor({state:'hidden',timeout:20000});await settle();
      const record=await find(row);if(!record)throw Error(`页面提交后未查到精确记录：${row.app} / ${row.name}`);
      journal[key]={phase:'done',hash:row.hash,record,time:new Date().toISOString()};await atomic(journalPath,journal);
      const item=checked.find(x=>x.app===row.app&&x.name===row.name);Object.assign(item,record,{status:'created'});
    }
  }
  const counts=checked.reduce((all,x)=>(all[x.status]=(all[x.status]||0)+1,all),{});
  console.log(JSON.stringify({status:mode==='check'?'checked':'done',total:checked.length,counts,pages:checked}));
}catch(error){await platformPage?.screenshot({path:failurePath}).catch(()=>{});console.error(JSON.stringify({status:'stopped',error:error.message,failurePath}));process.exitCode=1;
}finally{await context?.close();await lock.close();await fs.unlink(lockPath).catch(()=>{});}
