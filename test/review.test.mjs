import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {prepareDraft} from '../scripts/lib/draft.mjs';import {createReview,indexedCells} from '../scripts/lib/review.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=','base64');
async function fixture(t,{existing=false,properties="",mixed=false}={}){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tracking-review-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'image.png'),png);const manifest=path.join(dir,'draft.json');await fs.writeFile(manifest,JSON.stringify({title:'示例审核表',events:[{app:'示例应用',page:'示例页',element:'提交',action:'点击',developer:'开发甲',tester:'测试乙',description:'用户点击提交时上报',source:{kind:'prd-table',ref:'示例第2行'},image:{source:'prd',path:'image.png'}}]}));const source=JSON.parse(await fs.readFile(manifest));source.events[0].customProperties=properties;if(mixed)source.events.push({...source.events[0],element:'返回',customProperties:''});await fs.writeFile(manifest,JSON.stringify(source));const prepared=await prepareDraft(manifest,path.join(dir,'out'),()=>{throw Error('unexpected')},{findEvent:async row=>existing&&row.element==='提交'?{...row,eventName:row.expectedName,eventId:'click_example'}:null});return {dir,prepared:prepared.prepared,data:path.join(dir,'data')};}
function fake(){const cells=new Map(),calls=[];let token=0;const call=async(args,{input}={})=>{calls.push(args);const cmd=args[1],value=x=>args[args.indexOf(x)+1];
 if(cmd==='+workbook-create'){if(args.includes('--dry-run'))return {};const sheet=input.sheets[0];for(const [i,row] of [sheet.columns,...sheet.data].entries())for(const [j,v] of row.entries())cells.set(`${String.fromCharCode(65+j)}${i+1}`,{value:v});return {url:'https://example.feishu.cn/sheets/example'}}
 if(cmd==='+workbook-info')return {sheets:[{sheet_name:'埋点审核',sheet_id:'sheet1'}]};
 if(cmd==='+cells-set-image'){cells.set(value('--range'),{rich_text:[{type:'embed-image',image_token:'image'+(++token)}]});return {}};
 if(cmd==='+styles-put'){for(const sheet of input.styles)for(const style of sheet.cell_styles){const [,r,last]=style.range.match(/^A(\d+):([JK])\d+$/);for(let c=65;c<=last.charCodeAt(0);c++){const key=String.fromCharCode(c)+r;cells.set(key,{...cells.get(key),cell_styles:{background_color:style.background_color}})}}return {}};
 if(cmd==='+cells-get'){const range=value('--range');const [a,b=a]=range.split(':');const [,c1,n1]=a.match(/([A-Z])(\d+)/),[,c2,n2]=b.match(/([A-Z])(\d+)/);const rows=Array.from({length:Number(n2)-Number(n1)+1},(_,i)=>Number(n1)+i),cols=Array.from({length:c2.charCodeAt(0)-c1.charCodeAt(0)+1},(_,i)=>String.fromCharCode(c1.charCodeAt(0)+i));return {has_more:false,ranges:[{actual_range:range,row_indices:rows,col_indices:cols,cells:rows.map(r=>cols.map(c=>cells.get(c+r)||{}))}]}}
 throw Error('unexpected '+cmd);
 };return {call,cells,calls};}
test('review creates a new standard sheet, embeds image into H and reads it back',async t=>{const x=await fixture(t),api=fake();const result=await createReview(x.prepared,{data:x.data,call:api.call});assert.equal(result.status,'done');assert.equal(result.images,1);assert.equal(api.cells.get('I2').value,'');assert.equal(api.cells.get('J2').value,'');assert.equal(api.cells.get('H2').rich_text[0].type,'embed-image');await createReview(x.prepared,{data:x.data,call:api.call});assert.equal(api.calls.filter(x=>x[1]==='+workbook-create'&&!x.includes('--dry-run')).length,1);assert.equal(api.calls.filter(x=>x[1]==='+cells-set-image').length,1)});
test('unknown create result is journaled and never silently retried',async t=>{const x=await fixture(t);let writes=0;const call=async args=>{if(args.includes('--dry-run'))return {};writes++;throw Error('connection lost')};await assert.rejects(createReview(x.prepared,{data:x.data,call}),/connection lost/);await assert.rejects(createReview(x.prepared,{data:x.data,call}),/禁止自动再次新建/);assert.equal(writes,1)});
test('an edited image or result cell stops resume without overwriting',async t=>{const x=await fixture(t),api=fake();await createReview(x.prepared,{data:x.data,call:api.call});api.cells.set('H2',{rich_text:[{type:'embed-image',image_token:'someone-else'}]});await assert.rejects(createReview(x.prepared,{data:x.data,call:api.call}),/图片在生成后发生变化/);api.cells.set('I2',{value:'existing-result'});await assert.rejects(createReview(x.prepared,{data:x.data,call:api.call}),/内容与草稿不同/);assert.equal(api.calls.filter(x=>x[1]==='+cells-set-image').length,1)});
test('changed input image stops before creating anything',async t=>{const x=await fixture(t);await fs.writeFile(path.join(x.dir,'image.png'),Buffer.concat([png,Buffer.from('changed')]));let calls=0;await assert.rejects(createReview(x.prepared,{data:x.data,call:async()=>{calls++}}),/变化/);assert.equal(calls,0)});
test('readback uses explicit coordinates and rejects truncated results',()=>{const cell={value:'real H7'};const map=indexedCells({has_more:false,ranges:[{actual_range:'H7:H7',row_indices:[7],col_indices:['H'],cells:[[cell]]}]});assert.equal(map.get('H7'),cell);assert.throws(()=>indexedCells({has_more:true,ranges:[]}),/不完整/)});

test('editing a prepared draft does not create a second review sheet',async t=>{const x=await fixture(t),api=fake();await createReview(x.prepared,{data:x.data,call:api.call});const draft=JSON.parse(await fs.readFile(x.prepared));draft.rows[0].description='变更后的说明';await fs.writeFile(x.prepared,JSON.stringify(draft));await assert.rejects(createReview(x.prepared,{data:x.data,call:api.call}),/原审核表/);assert.equal(api.calls.filter(x=>x[1]==='+workbook-create'&&!x.includes('--dry-run')).length,1)});

test('existing events are yellow across A–K while new events and custom requirements stay intact',async t=>{
 const properties='来源：必填；首页/详情。\n金额：仅按 PRD 上报。';const x=await fixture(t,{existing:true,properties,mixed:true}),api=fake();
 const result=await createReview(x.prepared,{data:x.data,call:api.call});assert.equal(result.existing,1);assert.equal(result.new,1);
 for(let c=65;c<=75;c++){assert.equal(api.cells.get(String.fromCharCode(c)+'2').cell_styles.background_color,'#FFFF00');assert.equal(api.cells.get(String.fromCharCode(c)+'3').cell_styles?.background_color,undefined)}
 assert.equal(api.cells.get('J2').value,'已存在的事件');assert.equal(api.cells.get('K1').value,'自定义属性及要求');assert.equal(api.cells.get('K2').value,properties);assert.equal(api.cells.get('J3').value,'');assert.equal(api.cells.get('H2').rich_text[0].type,'embed-image');
 await createReview(x.prepared,{data:x.data,call:api.call});assert.equal(api.calls.filter(args=>args[1]==='+styles-put').length,1);
 api.cells.set('K2',{...api.cells.get('K2'),value:'用户修改了要求'});await assert.rejects(createReview(x.prepared,{data:x.data,call:api.call}),/K2 内容与草稿不同/);
});
test('existing events without properties highlight exactly A–J',async t=>{
 const x=await fixture(t,{existing:true}),api=fake();await createReview(x.prepared,{data:x.data,call:api.call});assert.equal(api.cells.has('K1'),false);assert.equal(api.cells.has('K2'),false);assert.equal(api.cells.get('A2').cell_styles.background_color,'#FFFF00');assert.equal(api.cells.get('J2').cell_styles.background_color,'#FFFF00');
});
test('a lost style response resumes the same sheet and never duplicates images or creation',async t=>{
 const x=await fixture(t,{existing:true,properties:'来源要求'}),api=fake();let lost=true;
 const call=async(args,opts)=>{const result=await api.call(args,opts);if(args[1]==='+styles-put'&&lost){lost=false;throw Error('style response lost')}return result};
 await assert.rejects(createReview(x.prepared,{data:x.data,call}),/response lost/);await createReview(x.prepared,{data:x.data,call});
 assert.equal(api.calls.filter(args=>args[1]==='+workbook-create'&&!args.includes('--dry-run')).length,1);assert.equal(api.calls.filter(args=>args[1]==='+cells-set-image').length,1);assert.equal(api.calls.filter(args=>args[1]==='+styles-put').length,1);assert.equal(api.cells.get('J2').value,'已存在的事件');
});
test('a partially applied highlight is detected and repaired before reporting success',async t=>{
 const x=await fixture(t,{existing:true}),api=fake();let partial=true;
 const call=async(args,opts)=>{const result=await api.call(args,opts);if(args[1]==='+styles-put'&&partial){partial=false;delete api.cells.get('H2').cell_styles}return result};
 await assert.rejects(createReview(x.prepared,{data:x.data,call}),/标黄未能完整核实/);await createReview(x.prepared,{data:x.data,call});assert.equal(api.cells.get('H2').cell_styles.background_color,'#FFFF00');assert.equal(api.calls.filter(args=>args[1]==='+cells-set-image').length,1);
});
test('legacy drafts and changed platform identities stop before any workbook write',async t=>{
 const x=await fixture(t);const original=JSON.parse(await fs.readFile(x.prepared));let calls=0;
 for(const mutate of [d=>{d.schemaVersion=1},d=>{delete d.rows[0].platformCheck},d=>{d.rows[0].app='另一应用'},d=>{delete d.rows[0].existingEvent}]){
  const changed=structuredClone(original);mutate(changed);await fs.writeFile(x.prepared,JSON.stringify(changed));await assert.rejects(createReview(x.prepared,{data:x.data,call:async()=>{calls++}}),/核对/);
 }
 assert.equal(calls,0);
});
