import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bootstrap=await fs.readFile(path.join(root,'install.sh'),'utf8');
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tracking-bootstrap-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const bin=path.join(dir,'bin'),repo=path.join(dir,'repo'),marker=path.join(dir,'installed.json');await fs.mkdir(bin);await fs.mkdir(path.join(repo,'scripts'),{recursive:true});
 await fs.writeFile(path.join(repo,'scripts/install.mjs'),`import fs from 'node:fs';fs.writeFileSync(process.env.TRACKING_TEST_MARKER,JSON.stringify(process.argv.slice(2)));`);
 await fs.writeFile(path.join(repo,'release.json'),'{}');
 const archive=path.join(dir,'archive.tar.gz');const tar=spawnSync('tar',['-czf',archive,'-C',dir,'repo']);assert.equal(tar.status,0);
 await fs.writeFile(path.join(bin,'curl'),`#!/bin/sh
printf '%s\\n' "$@" >> "$TRACKING_TEST_REQUESTS"
if [ "$TRACKING_TEST_DOWNLOAD_FAIL" = 1 ]; then exit 22; fi
out=''
while [ "$#" -gt 0 ]; do
 if [ "$1" = '-o' ]; then shift; out="$1"; fi
 shift
done
/bin/cp "$TRACKING_TEST_ARCHIVE" "$out"
`,{mode:0o755});
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,LI_AUTO_TRACKING_DATA:path.join(dir,'data'),TRACKING_TEST_ARCHIVE:archive,TRACKING_TEST_MARKER:marker,TRACKING_TEST_REQUESTS:path.join(dir,'requests')};
 return {dir,repo,env,marker};
}
test('piped installer downloads anonymously and forwards destination without trusting the current directory',async t=>{
 const x=await fixture(t);await fs.mkdir(path.join(x.dir,'scripts'));await fs.writeFile(path.join(x.dir,'release.json'),'{}');await fs.writeFile(path.join(x.dir,'scripts/install.mjs'),'throw Error("wrong current directory")');
 const result=spawnSync('/bin/bash',['-s','--','--dest',path.join(x.dir,'chosen directory')],{input:bootstrap,cwd:x.dir,env:x.env,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(await fs.readFile(x.marker)),['--dest',path.join(x.dir,'chosen directory')]);
 const request=await fs.readFile(x.env.TRACKING_TEST_REQUESTS,'utf8');assert.match(request,/codeload\.github\.com\/javenvian-del\/li-auto-event-tracking/);assert.doesNotMatch(request,/Authorization|token|password/);
});
test('failed download does not execute an installer or report success',async t=>{
 const x=await fixture(t);const result=spawnSync('/bin/bash',['-s'],{input:bootstrap,cwd:x.dir,env:{...x.env,TRACKING_TEST_DOWNLOAD_FAIL:'1'},encoding:'utf8'});
 assert.equal(result.status,22);assert.equal(await fs.stat(x.marker).catch(()=>null),null);
});
test('a truncated bootstrap never starts installation',async t=>{
 const x=await fixture(t);const incomplete=bootstrap.slice(0,bootstrap.lastIndexOf('\n}'));
 const result=spawnSync('/bin/bash',['-s'],{input:incomplete,cwd:x.dir,env:x.env,encoding:'utf8'});
 assert.notEqual(result.status,0);assert.equal(await fs.stat(x.env.LI_AUTO_TRACKING_DATA).catch(()=>null),null);
});
test('complete local package installs without downloading another release',async t=>{
 const x=await fixture(t);await fs.writeFile(path.join(x.repo,'install.sh'),bootstrap);
 const result=spawnSync('/bin/bash',[path.join(x.repo,'install.sh'),'--target','codex'],{cwd:x.dir,env:x.env,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(await fs.readFile(x.marker)),['--target','codex']);assert.equal(await fs.stat(x.env.TRACKING_TEST_REQUESTS).catch(()=>null),null);
});
