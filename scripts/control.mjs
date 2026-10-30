import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateConfig} from './lib/core.mjs';
import {checkUpdate,applyUpdate,saveJSON,folderDownloader,loadUpdateSource} from './lib/distribution.mjs';
import {doctor,withBrowser,pageURL} from './lib/runtime.mjs';
import {createInterface} from 'node:readline/promises';
import {assertBrowserExecutionAllowed, browserPermissionCode} from './lib/browser-permission.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),command=args[0];
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
const data=path.resolve(process.env.LI_AUTO_TRACKING_DATA||path.join(os.homedir(),'Documents','Codex','li-auto-event-tracking-data'));
const configFile=path.join(data,'config.json');
const introduction=()=>fs.readFile(path.join(path.dirname(root),'references/introduction.md'),'utf8');
const child=(file,cfg,extra=[],stdio='inherit')=>new Promise((resolve,reject)=>{
 const p=spawn(process.execPath,[path.join(root,file),...extra,'--config',cfg],{stdio});
 p.once('error',reject);p.once('exit',(code,signal)=>resolve({code,signal}));
});
export function parseRows(spec){
 if(!spec)throw Error('必须指定已确认的行区间，例如 --rows 6-18');
 const rows=[];
 for(const part of spec.split(',')){
  const m=part.trim().match(/^(\d+)(?:-(\d+))?$/);if(!m)throw Error('行区间格式错误');
  const a=Number(m[1]),b=Number(m[2]||m[1]);
  if(a<2||b<a||b>100000||b-a>10000)throw Error('行区间无效');
  for(let n=a;n<=b;n++)rows.push(n);
 }
 return [...new Set(rows)].sort((a,b)=>a-b);
}
const summary=x=>({status:x.status,total:x.rows?.length??0,completed:x.results?.length??0,counts:(x.results??[]).reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),...(x.error?{failedRow:x.failedRow,error:x.error}:{})});
async function main(){
 const skillRoot=path.dirname(root);
 if(['check-login','login','events-check','run','pages-check','pages-run','check-platform','platform-login'].includes(command))assertBrowserExecutionAllowed();
 if(command==='intro'||command==='guide-seen'){
  console.log(JSON.stringify({guideNeeded:true,introduction:await introduction(),...(command==='guide-seen'?{status:'not_saved',message:'按当前对话展示介绍，不保存全局已读标记。'}:{})}));return;
 }
 if(['start','update-check','doctor','update'].includes(command)){
  const updateOptions = option('--downloaded-source') ? {download:folderDownloader(option('--downloaded-source'),await loadUpdateSource(data))} : {};
  if(command==='update') {
   const result=await applyUpdate(skillRoot,{...updateOptions,version:option('--version'),confirmed:args.includes('--confirmed')});
   console.log(JSON.stringify({...result,guideNeeded:true,introduction:await introduction().catch(()=>undefined)}));return;
  }
  if(command==='doctor'){console.log(JSON.stringify(await doctor()));return;}
  const update=await checkUpdate(skillRoot,updateOptions);
  if(command==='update-check'){console.log(JSON.stringify(update));return;}
  const guideNeeded=!args.includes('--continue');
  console.log(JSON.stringify({update,environment:await doctor(),guideNeeded,...(guideNeeded?{introduction:await introduction()}:{})}));return;
 }
 if(command==='draft-prepare'||command==='review-create'){
  const result=await child(command==='draft-prepare'?'draft-prepare.mjs':'review-create.mjs',configFile,args.slice(1));process.exitCode=result.code??1;return;
 }
 if(command==='platform-init'){
  const previous=await fs.readFile(configFile,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return {};throw e});
  const c={...previous,platformUrl:option('--platform-url'),channel:previous.channel||'chrome',stateDir:previous.stateDir||path.join(data,'state')};
  pageURL(c);await saveJSON(configFile,c);console.log('{"status":"configured"}');return;
 }
 if(command==='platform-login'||command==='check-platform'){
  const c=JSON.parse(await fs.readFile(configFile,'utf8'));pageURL(c);
  await withBrowser(c,async context=>{
   const p=await context.newPage();await p.goto(c.platformUrl,{waitUntil:'domcontentloaded'});
   if(command==='platform-login'){
    console.log('请在打开的 Chrome 中登录运营平台。登录后告诉助手，助手将继续检查。');
    const rl=createInterface({input:process.stdin,output:process.stdout});await rl.question('');rl.close();
   }
   await p.getByRole('textbox',{name:'请选择应用',exact:true}).waitFor({timeout:20000});
   console.log('{"platform":"ready"}');
  },{headless:command!=='platform-login'});return;
 }
 if(command==='init'){
  const sheetUrl=option('--sheet-url');if(!sheetUrl)throw Error('需要 --sheet-url 飞书链接');
  if(!option('--sheet-name'))throw Error('请先读取表格实际工作表名称，再指定 --sheet-name');
  const previous=await fs.readFile(configFile,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return {};throw e});
  const c={sheetUrl,sheetName:option('--sheet-name'),platformUrl:option('--platform-url')||previous.platformUrl,...(option('--page-platform-url')?{pagePlatformUrl:option('--page-platform-url')}:{ }),rows:[2],columns:{app:'A',page:'B',element:'C',action:'D',developer:'E',tester:'F',description:'G',image:'H',eventName:'I',eventId:'J'},images:{},channel:'chrome',stateDir:option('--state-dir')?path.resolve(option('--state-dir')):previous.stateDir||path.join(data,'state')};
  validateConfig(c);await fs.mkdir(data,{recursive:true,mode:0o700});
  // Explicit init changes the selected sheet, never copies credentials into the skill.
  await fs.writeFile(configFile,JSON.stringify(c,null,2),{mode:0o600});console.log(JSON.stringify({status:'configured',configFile}));return;
 }
 if(!['check-login','login','events-check','run','status','pages-check','pages-run'].includes(command))throw Error('用法：start [--continue] | intro | update-check | update --version X.Y.Z --confirmed | doctor | platform-init --platform-url URL | platform-login | check-platform | draft-prepare --manifest JSON --output DIR | review-create --prepared JSON | init --sheet-url URL --sheet-name NAME | check-login | login | events-check --rows 6-18 | run --rows 6-18 --confirmed | pages-check --manifest JSON | pages-run --manifest JSON --confirmed | status');
 const c=JSON.parse(await fs.readFile(configFile,'utf8').catch(()=>{throw Error('先运行 init --sheet-url URL')}));
 if(command==='check-login'||command==='login'){
  const result=await child(command==='login'?'run.mjs':'session.mjs',configFile,command==='login'?['--login']:[]);process.exitCode=result.code??1;return;
 }
 if(command==='pages-check'||command==='pages-run'){
  const manifest=option('--manifest');if(!manifest)throw Error('需要 --manifest 页面清单');
  if(command==='pages-run'&&!args.includes('--confirmed'))throw Error('创建页面前需向用户展示页面清单并获得确认，然后使用 --confirmed');
  const result=await child('page-batch.mjs',configFile,[command==='pages-run'?'--create':'--check','--manifest',path.resolve(manifest)]);process.exitCode=result.code??1;return;
 }
 if(command==='status'){
  const latest=JSON.parse(await fs.readFile(path.join(data,'last-run.json'),'utf8'));
  const x=JSON.parse(await fs.readFile(latest.resultsPath,'utf8'));console.log(JSON.stringify(summary(x)));return;
 }
 if(command==='run'&&!args.includes('--confirmed'))throw Error('创建事件前需确认已预检的表格和行范围，然后使用 --confirmed');
 const excluded=new Set(option('--exclude')?parseRows(option('--exclude')):[]);
 c.rows=parseRows(option('--rows')).filter(n=>!excluded.has(n));validateConfig(c);
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'),runDir=path.join(data,'runs',stamp);
 await fs.mkdir(runDir,{recursive:true,mode:0o700});
 const cfg=path.join(runDir,'config.json'),logPath=path.join(runDir,'execution.log');
 await fs.writeFile(cfg,JSON.stringify(c,null,2),{mode:0o600});
 const key=createHash('sha256').update(c.sheetUrl.split('?')[0]+'\n'+c.sheetName).digest('hex').slice(0,16);
 const mode=command==='events-check'?'check':'create';
 const resultsPath=path.join(c.stateDir,key,`${mode==='check'?'check':'batch'}-${c.rows[0]}-${c.rows.at(-1)}.json`);
 await fs.writeFile(path.join(data,'last-run.json'),JSON.stringify({resultsPath,logPath,cfg}),{mode:0o600});
 const log=await fs.open(logPath,'wx',0o600);
 let result;
 try{result=await child('batch.mjs',cfg,[mode==='check'?'--check':'--create'],['ignore',log.fd,log.fd]);}finally{await log.close();}
 if(result.code!==0){console.error(JSON.stringify({status:'stopped',logPath,message:mode==='check'?'预检停止；未创建事件或回写表格。':'创建批次停止，读取本次日志末尾定位异常；不得自动重跑提交。'}));process.exitCode=1;return;}
 const x=JSON.parse(await fs.readFile(resultsPath,'utf8'));console.log(JSON.stringify({...summary(x),resultsPath}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main().catch(e=>{
 if(e.code===browserPermissionCode){console.error(JSON.stringify({status:'permission_required',code:e.code,message:e.message,browserStarted:false}));process.exitCode=77;}
 else{console.error(e.message);process.exitCode=1;}
});
