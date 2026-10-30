import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {checkSessions} from './lib/session.mjs';
import {validateConfig} from './lib/core.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),ci=args.indexOf('--config');
const config=JSON.parse(await fs.readFile(ci<0?path.join(root,'config.json'):path.resolve(args[ci+1]),'utf8'));
validateConfig({...config,rows:[2],elementOverrides:undefined});
const local=path.resolve(config.stateDir||path.join(root,'.local'));
await fs.mkdir(local,{recursive:true,mode:0o700});
const lockPath=path.join(local,'run.lock'),lock=await fs.open(lockPath,'wx',0o600);
let c;
try{
 let pw;try{pw=await import('playwright')}catch{pw=await import(pathToFileURL(path.join(process.env.HOME,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href)}
 c=await pw.chromium.launchPersistentContext(path.join(local,'browser-profile'),{channel:config.channel||'chrome',headless:true,acceptDownloads:false});
 const sp=await c.newPage(),pp=await c.newPage();
 await Promise.all([sp.goto(config.sheetUrl,{waitUntil:'domcontentloaded'}),pp.goto(config.platformUrl,{waitUntil:'domcontentloaded'})]);
 console.log(JSON.stringify({status:'ready',...await checkSessions(sp,pp)}));
}catch(e){console.error(JSON.stringify({status:'blocked',sessions:e.sessions,error:e.message}));process.exitCode=1;}
finally{await c?.close();await lock.close();await fs.unlink(lockPath);}
