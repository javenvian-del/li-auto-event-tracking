import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {validateConfig} from './lib/core.mjs';
import {checkSessions} from './lib/session.mjs';
import {assertBrowserExecutionAllowed} from './lib/browser-permission.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.includes('--help')) {console.log('node run.mjs --login --config config.json\n此脚本只负责交互登录；事件预检和创建必须通过 control.mjs。');process.exit(0);}
if(!args.includes('--login')||args.some(a=>a==='--check'||a==='--create')) throw Error('旧的直接检查/创建入口已禁用；请使用 run.sh events-check 或 run.sh run');
assertBrowserExecutionAllowed();
const ci=args.indexOf('--config'),cfgPath=path.resolve(ci<0?path.join(root,'config.json'):args[ci+1]??'');
const config=JSON.parse(await fs.readFile(cfgPath,'utf8').catch(()=>{throw Error('请先将config.example.json复制为config.json');}));
validateConfig(config);
const local=path.resolve(config.stateDir||path.join(root,'.local'));await fs.mkdir(local,{recursive:true,mode:0o700});
const lock=path.join(local,'run.lock');
let lockHandle;
try {lockHandle=await fs.open(lock,'wx',0o600);} catch {throw Error('已有助手运行或上次异常中断。确认所有助手窗口关闭后再删除.local/run.lock');}
let context;
try {
  let pw;
  try {pw=await import('playwright');} catch {
    const bundled=path.join(process.env.HOME,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
    pw=await import(pathToFileURL(bundled).href);
  }
  context=await pw.chromium.launchPersistentContext(path.join(local,'browser-profile'),{channel:config.channel||'chrome',headless:false,acceptDownloads:false,viewport:{width:1440,height:1000}});
  const sheetPage=await context.newPage(),platformPage=await context.newPage();
  await sheetPage.goto(config.sheetUrl,{waitUntil:'domcontentloaded'});
  await platformPage.goto(config.platformUrl,{waitUntil:'domcontentloaded'});
  console.log('请在新开的浏览器中登录飞书和埋点平台；不要在这个步骤创建事件。');
  const rl=createInterface({input:stdin,output:stdout});await rl.question('两个页面均登录完成后，在这里按回车保存会话。');rl.close();
  await checkSessions(sheetPage,platformPage);
} finally {if(context) await context.close();await lockHandle.close();await fs.unlink(lock);}
