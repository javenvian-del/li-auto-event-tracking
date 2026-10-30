import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkUpdate, applyUpdate, installSource, digest, validateRelease, loadUpdateSource, sourceDownloader, folderDownloader, defaultReleaseSource} from '../scripts/lib/distribution.mjs';
async function fixture(t) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracking-update-test-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'installed'),source=path.join(dir,'source'),data=path.join(dir,'data');await fs.mkdir(root);await fs.mkdir(source);
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.0'}));await fs.writeFile(path.join(root,'SKILL.md'),'original');
 const content={'SKILL.md':'new skill','package.json':JSON.stringify({name:'li-auto-event-tracking',version:'1.1.0',dependencies:{playwright:'1.62.1'}}),'run.sh':'launcher','scripts/control.mjs':'control','scripts/lib/distribution.mjs':'distribution'};
 const release={schemaVersion:1,version:'1.1.0',notes:['update'],files:Object.fromEntries(Object.entries(content).map(([k,v])=>[k,digest(v)]))};
 for(const [name,value] of Object.entries(content)){await fs.mkdir(path.dirname(path.join(source,name)),{recursive:true});await fs.writeFile(path.join(source,name),value);}
 const bytes=Buffer.from(JSON.stringify(release));await fs.writeFile(path.join(source,'release.json'),bytes);
 return {dir,root,source,data,release,bytes,download:async name=>name==='release.json'?bytes:Buffer.from(content[name])};
}
test('each invocation checks online and never installs just because an update exists',async t=>{
 const x=await fixture(t);let calls=0;const download=async name=>{calls++;return x.download(name)};
 assert.equal((await checkUpdate(x.root,{data:x.data,download})).status,'available');await checkUpdate(x.root,{data:x.data,download});assert.equal(calls,2);
 assert.equal(await fs.readFile(path.join(x.root,'SKILL.md'),'utf8'),'original');
 await assert.rejects(applyUpdate(x.root,{data:x.data,version:'1.1.0',download}),/确认/);
});
test('offline check states unavailable instead of current and preserves installation',async t=>{
 const x=await fixture(t);assert.equal((await checkUpdate(x.root,{data:x.data,download:async()=>{throw Error('offline')}})).status,'unavailable');
 assert.equal(await fs.readFile(path.join(x.root,'SKILL.md'),'utf8'),'original');
});
test('confirmation is bound to the checked version and complete manifest',async t=>{
 const x=await fixture(t);await checkUpdate(x.root,{data:x.data,download:x.download});
 await assert.rejects(applyUpdate(x.root,{data:x.data,version:'1.2.0',confirmed:true,download:x.download}),/尚未检查/);
 await assert.rejects(applyUpdate(x.root,{data:x.data,version:'1.1.0',confirmed:true,download:async()=>Buffer.from(JSON.stringify({...x.release,notes:['changed']}))}),/云端版本已变化/);
});
test('corrupt downloads fail before installation',async t=>{
 const x=await fixture(t);await checkUpdate(x.root,{data:x.data,download:x.download});let installed=false;
 await assert.rejects(applyUpdate(x.root,{data:x.data,version:'1.1.0',confirmed:true,download:async name=>name==='SKILL.md'?Buffer.from('corrupt'):x.download(name),install:async()=>{installed=true}}),/校验失败/);
 assert.equal(installed,false);assert.equal(await fs.readFile(path.join(x.root,'SKILL.md'),'utf8'),'original');
});
test('confirmed update replaces only the package, backs up prior version and preserves user data',async t=>{
 const x=await fixture(t);await fs.mkdir(x.data);await fs.writeFile(path.join(x.data,'private-log'),'keep');await checkUpdate(x.root,{data:x.data,download:x.download});
 const result=await applyUpdate(x.root,{data:x.data,version:'1.1.0',confirmed:true,download:x.download,install:(source,root,options)=>installSource(source,root,{...options,prepareDependencies:async()=>{}})});
 assert.equal(result.version,'1.1.0');assert.equal(await fs.readFile(path.join(x.root,'SKILL.md'),'utf8'),'new skill');assert.equal(await fs.readFile(path.join(result.backup,'SKILL.md'),'utf8'),'original');assert.equal(await fs.readFile(path.join(x.data,'private-log'),'utf8'),'keep');
});
test('dependency failures and active batches preserve existing skill',async t=>{
 const x=await fixture(t);await assert.rejects(installSource(x.source,x.root,{data:x.data,prepareDependencies:async()=>{throw Error('dependency failure')}}),/dependency failure/);
 assert.equal(await fs.readFile(path.join(x.root,'SKILL.md'),'utf8'),'original');
 await fs.mkdir(path.join(x.data,'state'),{recursive:true});await fs.writeFile(path.join(x.data,'state/run.lock'),'active');
 await assert.rejects(installSource(x.source,x.root,{data:x.data,prepareDependencies:async()=>{}}),/运行中/);assert.equal(await fs.readFile(path.join(x.data,'state/run.lock'),'utf8'),'active');
});
test('release cannot write outside skill or install runtime credentials',async t=>{
 const x=await fixture(t);for(const name of ['../escape','scripts/../../escape.mjs','config.json','.local/token.json','scripts//x.mjs'])assert.throws(()=>validateRelease({...x.release,files:{...x.release.files,[name]:'0'.repeat(64)}}),/非法/);
});

test('a previously confirmed update cannot downgrade an independently upgraded installation',async t=>{const x=await fixture(t);await checkUpdate(x.root,{data:x.data,download:x.download});await fs.writeFile(path.join(x.root,'package.json'),JSON.stringify({version:'1.2.0'}));await assert.rejects(applyUpdate(x.root,{data:x.data,version:'1.1.0',confirmed:true,download:x.download}),/相同或更新版本/)});

test('default source checks the public release without sending personal credentials',async t=>{
 const x=await fixture(t);const source=await loadUpdateSource(x.data);
 assert.deepEqual(source,defaultReleaseSource);assert.equal(new URL(source.baseUrl).hostname,'raw.githubusercontent.com');assert.equal(source.tokenEnv,undefined);
 const download=sourceDownloader(source,{env:{LI_AUTO_TRACKING_GITHUB_TOKEN:'must-not-send'},request:async(url,options)=>{assert.equal(options.headers.Authorization,undefined);assert.equal(options.redirect,'error');return new Response(x.bytes)}});
 assert.equal((await checkUpdate(x.root,{data:x.data,download})).status,'available');
 assert.equal(await fs.readFile(path.join(x.root,'SKILL.md'),'utf8'),'original');
});
test('custom sources reject insecure URLs, inline credentials and credentials on public raw URLs',async t=>{
 const x=await fixture(t);await fs.mkdir(x.data);
 for(const baseUrl of ['http://example.test/private/','https://user:secret@example.test/private/','https://example.test/private/?token=secret','https://api.github.com/repos/example/private/contents/']){
  await fs.writeFile(path.join(x.data,'update-source.json'),JSON.stringify({baseUrl}));
  await assert.rejects(loadUpdateSource(x.data));
 }
 await fs.writeFile(path.join(x.data,'update-source.json'),JSON.stringify({...defaultReleaseSource,tokenEnv:'PERSONAL_TOKEN'}));await assert.rejects(loadUpdateSource(x.data),/不应携带个人令牌/);
 const expected={baseUrl:'https://api.github.com/repos/example/private/contents/skill/',tokenEnv:'LI_AUTO_SKILL_TOKEN'};
 await fs.writeFile(path.join(x.data,'update-source.json'),JSON.stringify(expected));assert.deepEqual(await loadUpdateSource(x.data),expected);
});
test('private download uses personal authorization, refuses redirects and cannot escape the source directory',async()=>{
 const source={baseUrl:'https://api.github.com/repos/example/private/contents/skill/',tokenEnv:'LI_AUTO_SKILL_TOKEN'};let calls=0;
 assert.throws(()=>sourceDownloader(source,{env:{}}),/授权未配置/);
 const download=sourceDownloader(source,{env:{LI_AUTO_SKILL_TOKEN:'test-only-token'},request:async(url,options)=>{
  calls++;assert.equal(url.href,source.baseUrl+'release.json');assert.equal(options.headers.Authorization,'Bearer test-only-token');assert.equal(options.headers.Accept,'application/vnd.github.raw+json');assert.equal(options.redirect,'error');return new Response('manifest');
 }});
 assert.equal(String(await download('release.json')),'manifest');
 for(const name of ['../secret','//other.test/token','https://other.test/token','scripts/../../escape','scripts/%2e%2e/escape'])await assert.rejects(download(name),/路径无效/);
 assert.equal(calls,1);
});
test('changed private source requires fresh update approval even for the same manifest',async t=>{
 const x=await fixture(t);const first=async name=>x.download(name);first.sourceId='source-one';
 await checkUpdate(x.root,{data:x.data,download:first});const second=async name=>x.download(name);second.sourceId='source-two';
 await assert.rejects(applyUpdate(x.root,{data:x.data,version:'1.1.0',confirmed:true,download:second}),/更新源已变化/);
 assert.equal(await fs.readFile(path.join(x.root,'SKILL.md'),'utf8'),'original');
});
test('connector-downloaded updates keep version approval and file integrity checks without exposing a token',async t=>{
 const x=await fixture(t);const download=folderDownloader(x.source,defaultReleaseSource);
 assert.equal((await checkUpdate(x.root,{data:x.data,download})).status,'available');
 await assert.rejects(applyUpdate(x.root,{data:x.data,version:'1.1.0',download}),/确认/);
 await fs.writeFile(path.join(x.source,'SKILL.md'),'tampered');
 await assert.rejects(applyUpdate(x.root,{data:x.data,version:'1.1.0',confirmed:true,download}),/校验失败/);
 await assert.rejects(download('../outside'),/路径无效/);
});
