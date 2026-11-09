// Every batch is fully validated locally and on the platform before any submit.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Sheet} from './lib/sheet.mjs';
import {Platform} from './lib/platform.mjs';
import {validateConfig,processRow,fingerprint,shouldSkipRecorded,hashImage} from './lib/core.mjs';
import {checkSessions} from './lib/session.mjs';
import {assertBrowserExecutionAllowed} from './lib/browser-permission.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),ci=args.indexOf('--config');
const mode=args.includes('--check')?'check':args.includes('--create')?'create':null;
if(ci<0||!args[ci+1]||!mode||args.filter(x=>x==='--check'||x==='--create').length!==1)throw Error('用法：node batch.mjs (--check | --create) --config 配置文件');
assertBrowserExecutionAllowed();
const config=JSON.parse(await fs.readFile(path.resolve(args[ci+1]),'utf8'));validateConfig(config);
const local=path.resolve(config.stateDir||path.join(root,'.local'));
const key=createHash('sha256').update(config.sheetUrl.split('?')[0]+'\n'+config.sheetName).digest('hex').slice(0,16);
const dir=path.join(local,key);await fs.mkdir(dir,{recursive:true,mode:0o700});
const lockPath=path.join(local,'run.lock'),lock=await fs.open(lockPath,'wx',0o600);
const atomic=async(file,obj)=>{await fs.writeFile(file+'.tmp',JSON.stringify(obj,null,2),{mode:0o600});await fs.rename(file+'.tmp',file)};
const read=async(file)=>JSON.parse(await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e}));
const journalPath=path.join(dir,'journal.json'),planPath=path.join(dir,'checked.json');
const resultsPath=path.join(dir,`${mode==='check'?'check':'batch'}-${config.rows[0]}-${config.rows.at(-1)}.json`);
let context,activeRow;
const results=[],state=await read(journalPath),checked=await read(planPath);
try{
  if(mode==='create'&&JSON.stringify(checked.__plan?.rows)!==JSON.stringify(config.rows))throw Error('本次行范围与最近一次预检不一致，请重新运行 events-check');
  await atomic(resultsPath,{status:'running',mode,rows:config.rows,results,startedAt:new Date().toISOString()});
  let pw;try{pw=await import('playwright')}catch{pw=await import(pathToFileURL(path.join(process.env.HOME,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href)}
  context=await pw.chromium.launchPersistentContext(path.join(local,'browser-profile'),{channel:config.channel||'chrome',headless:true,acceptDownloads:false,viewport:{width:1440,height:1000}});
  const sheetPage=await context.newPage(),platformPage=await context.newPage();
  await Promise.all([sheetPage.goto(config.sheetUrl,{waitUntil:'domcontentloaded'}),platformPage.goto(config.platformUrl,{waitUntil:'domcontentloaded'})]);
  await checkSessions(sheetPage,platformPage);
  const sheet=new Sheet(sheetPage,config,path.join(dir,'images')),platform=new Platform(platformPage);await sheet.ready();
  const seen=new Set(),rows=[];

  // Phase 1: read and validate the complete sheet range before touching the platform form.
  for(const n of config.rows){
    activeRow=n;
    const recorded={eventName:await sheet.read(`${config.columns.eventName}${n}`),eventId:await sheet.read(`${config.columns.eventId}${n}`)};
    if(shouldSkipRecorded(recorded,state[n])){results.push({row:n,status:'skipped_recorded',record:recorded});continue}
    const row=await sheet.row(n);row.imagePath=await sheet.image(row);row.imageHash=await hashImage(row.imagePath);row.hash=fingerprint(row)+':'+row.imageHash;
    if(state[n]&&state[n].hash!==row.hash)throw Error(`第${n}行输入与已有执行记录冲突`);
    if(mode==='create'&&checked[n]?.hash!==row.hash)throw Error(`第${n}行未通过本次内容预检，或预检后内容发生变化`);
    const identity=row.app+'\n'+row.expectedName;if(seen.has(identity))throw Error(`本批次出现同名事件：${row.expectedName}`);seen.add(identity);
    rows.push(row);
  }

  // Phase 2: query every event and inspect every required option before the first submit.
  const plans=[];
  for(const row of rows){
    activeRow=row.row;
    const journal=async update=>{state[row.row]={...state[row.row],...update,hash:row.hash,time:new Date().toISOString()};await atomic(journalPath,state)};
    const check=await processRow({row,mode:'check',platform,sheet,journal,entry:state[row.row]});
    plans.push({row,journal,check});
    if(mode==='check')checked[row.row]={hash:row.hash,time:new Date().toISOString(),status:check.status};
  }
  if(mode==='check'){
    checked.__plan={rows:config.rows,checkedAt:new Date().toISOString()};
    await atomic(planPath,checked);
    for(const {row,check} of plans)results.push({row:row.row,status:check.status,record:check.record});
    await atomic(resultsPath,{status:'checked',mode,rows:config.rows,results});
    console.log(JSON.stringify({status:'checked',total:config.rows.length,counts:results.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),resultsPath}));
  }else{
    // Phase 3: the exact checked inputs may now be submitted sequentially.
    for(const {row,journal} of plans){
      activeRow=row.row;
      const result=await processRow({row,mode:'create',platform,sheet,journal,entry:state[row.row]});
      if(result.status!=='skipped_existing'){
        const name=await sheet.read(`${config.columns.eventName}${row.row}`),id=await sheet.read(`${config.columns.eventId}${row.row}`);
        if(name!==result.record.eventName||id!==result.record.eventId)throw Error('最终回写核验失败');
      }
      results.push({row:row.row,...result});
      await atomic(resultsPath,{status:'running',mode,rows:config.rows,results});
    }
    await atomic(resultsPath,{status:'done',mode,rows:config.rows,results});
    console.log(JSON.stringify({status:'done',total:config.rows.length,counts:results.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),resultsPath}));
  }
}catch(error){
  await atomic(resultsPath,{status:'stopped',mode,rows:config.rows,results,failedRow:activeRow,error:error.message});
  console.error(JSON.stringify({status:'stopped',failedRow:activeRow,error:error.message,resultsPath}));
  if(context){for(const [i,page]of context.pages().entries())await page.screenshot({path:path.join(dir,`batch-failure-${i}.png`)}).catch(()=>{})}
  process.exitCode=1;
}finally{await context?.close();await lock.close();await fs.unlink(lockPath).catch(()=>{})}
