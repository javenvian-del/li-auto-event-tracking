import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {platformURL,pageURL,configurePlatform,assertImageURL,imageOrigin,platformSetupStatus,platformAddressPrompt} from '../scripts/lib/platform-config.mjs';
import {PageCatalog} from '../scripts/lib/page-catalog.mjs';
const exec=promisify(execFile),root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const platformUrl='https://tracking.example.invalid/console/event';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tracking-private-config-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const configFile=path.join(dir,'config.json');const run=async(...args)=>JSON.parse((await exec(process.execPath,[path.join(root,'scripts/control.mjs'),...args],{env:{...process.env,LI_AUTO_TRACKING_DATA:dir}})).stdout);return {dir,configFile,run};}

test('first invocation returns the privacy explanation and configured users do not receive a repeated address request',async t=>{
 const x=await fixture(t);const first=await x.run('start','--downloaded-source',root);
 assert.equal(first.platform.status,'needs_setup');assert.equal(first.platform.prompt,platformAddressPrompt);assert.match(first.platform.prompt,/为避免系统地址泄漏/);assert.equal(await fs.stat(x.configFile).catch(()=>null),null);
 await x.run('platform-init','--platform-url',platformUrl);const bytes=await fs.readFile(x.configFile,'utf8');assert.equal(JSON.parse(bytes).platformUrl,platformUrl);
 const next=await x.run('start','--downloaded-source',root);assert.deepEqual(next.platform,{status:'configured'});assert.equal(JSON.stringify(next).includes('tracking.example.invalid'),false);assert.equal(await fs.readFile(x.configFile,'utf8'),bytes);
});
test('old local configurations are recognized without migration or overwriting unrelated settings',async t=>{
 const x=await fixture(t);const bytes=JSON.stringify({platformUrl,stateDir:'private-session',sheetName:'既有审核表',rows:[2]});await fs.writeFile(x.configFile,bytes);
 assert.deepEqual(await platformSetupStatus(x.configFile),{status:'configured'});assert.equal(await fs.readFile(x.configFile,'utf8'),bytes);
});
test('malformed local configuration is preserved and is not treated as a first installation',async t=>{
 const x=await fixture(t);await fs.writeFile(x.configFile,'broken');assert.equal((await platformSetupStatus(x.configFile)).status,'needs_attention');assert.equal(await fs.readFile(x.configFile,'utf8'),'broken');
 await fs.writeFile(x.configFile,JSON.stringify({platformUrl:'http://tracking.example.invalid/console/event'}));assert.equal((await platformSetupStatus(x.configFile)).status,'needs_attention');
});
test('platform validation uses the user supplied HTTPS origin and keeps page navigation on that origin',()=>{
 assert.equal(platformURL({platformUrl}).origin,'https://tracking.example.invalid');assert.equal(pageURL({platformUrl}),'https://tracking.example.invalid/console/page');
 for(const value of ['http://tracking.example.invalid/console/event','https://user:password@tracking.example.invalid/console/event','file:///console/event','https://tracking.example.invalid/login'])assert.throws(()=>platformURL({platformUrl:value}));
 assert.throws(()=>platformURL({}),/为避免系统地址泄漏/);
 assert.throws(()=>pageURL({platformUrl,pagePlatformUrl:'https://other.example.invalid/console/page'}),/同一运营平台/);
 assert.throws(()=>pageURL({platformUrl,pagePlatformUrl:'https://user:password@tracking.example.invalid/console/page'}),/账号或密码/);
});
test('image origins require exact local approval and reject lookalikes, credentials and insecure requests',()=>{
 const config={platformUrl,imageOrigins:['https://images.example.invalid']};
 assert.equal(assertImageURL(config,'https://tracking.example.invalid/a.png').origin,'https://tracking.example.invalid');
 assert.equal(assertImageURL(config,'https://images.example.invalid/a.png?signature=example').origin,'https://images.example.invalid');
 for(const value of ['https://sub.images.example.invalid/a.png','https://images.example.invalid.other.test/a.png','https://images.example.invalid:444/a.png','https://other.example.invalid/a.png'])assert.throws(()=>assertImageURL(config,value),{code:'IMAGE_ORIGIN_NOT_CONFIGURED'});
 assert.throws(()=>assertImageURL(config,'http://images.example.invalid/a.png'),/HTTPS/);assert.throws(()=>assertImageURL(config,'https://user:password@images.example.invalid/a.png'),/账号或密码/);
 for(const value of ['https://images.example.invalid/file.png','https://images.example.invalid/?token=example','https://images.example.invalid/#fragment'])assert.throws(()=>imageOrigin(value),/不包含/);
});
test('switching the platform origin drops old page and image approvals while same origin setup preserves them',()=>{
 const old={platformUrl,pagePlatformUrl:'https://tracking.example.invalid/console/page',imageOrigins:['https://images.example.invalid'],stateDir:'private-session'};
 assert.deepEqual(configurePlatform(old,{platformUrl}),old);
 const next=configurePlatform(old,{platformUrl:'https://other.example.invalid/console/event'});assert.equal(next.imageOrigins,undefined);assert.equal(next.pagePlatformUrl,undefined);assert.equal(next.stateDir,old.stateDir);
});
test('image approval is local, explicit, and survives initialization of a review sheet',async t=>{
 const x=await fixture(t);await x.run('platform-init','--platform-url',platformUrl);
 await assert.rejects(x.run('platform-image-origin','--origin','https://images.example.invalid'),/确认/);
 await x.run('platform-image-origin','--origin','https://images.example.invalid','--confirmed');
 const previous=JSON.parse(await fs.readFile(x.configFile));previous.elementOverrides={2:{source:'按钮✅',value:'按钮'}};await fs.writeFile(x.configFile,JSON.stringify(previous));
 await x.run('init','--sheet-url','https://example.feishu.cn/sheets/example','--sheet-name','审核');
 const initialized=JSON.parse(await fs.readFile(x.configFile));assert.deepEqual(initialized.imageOrigins,['https://images.example.invalid']);assert.equal(initialized.elementOverrides,undefined);
 await x.run('platform-init','--platform-url','https://other.example.invalid/console/event');assert.equal(JSON.parse(await fs.readFile(x.configFile)).imageOrigins,undefined);
});
test('page screenshot download never requests an unapproved origin and keeps redirects disabled after approval',async t=>{
 const x=await fixture(t),requests=[];
 const image={waitFor:async()=>{},evaluate:async()=> 'https://images.example.invalid/page.png'};
 const images={first:()=>image,count:async()=>1};
 const page={url:()=>platformUrl,getByRole:()=>({getByText:()=>({click:async()=>{}}),locator:()=>images}),context:()=>({request:{get:async(url,options)=>{requests.push({url,options});return {ok:()=>true,body:async()=>Buffer.from([137,80,78,71,13,10,26,10])}}}})};
 const config={platformUrl},catalog=new PageCatalog(page,config);catalog.find=async()=>({id:'p_example',cell:{click:async()=>{}}});catalog.close=async()=>{};
 await assert.rejects(catalog.download('示例应用','示例页',x.dir),{code:'IMAGE_ORIGIN_NOT_CONFIGURED'});assert.equal(requests.length,0);
 config.imageOrigins=['https://images.example.invalid'];const result=await catalog.download('示例应用','示例页',x.dir);assert.equal(requests.length,1);assert.equal(requests[0].options.maxRedirects,0);assert.equal(result.source,'platform');assert.ok((await fs.stat(result.path)).isFile());
});
