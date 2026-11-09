import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {prepareDraft,mapEvent} from '../scripts/lib/draft.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=','base64');
const event={app:'示例应用',page:'订单页',element:'提交',action:'点击',developer:'开发甲',tester:'测试乙',description:'用户点击提交按钮时上报',source:{kind:'prd-table',ref:'PRD埋点表第2行'}};
const absent={findEvent:async()=>null};
const existing=row=>({...row,eventName:row.expectedName,eventId:'click_example',developer:'原开发',description:'旧版说明'});
async function fixture(t,events){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tracking-draft-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'prd.png'),png);const file=path.join(dir,'draft.json');await fs.writeFile(file,JSON.stringify({title:'示例审核表',events}));return {dir,file,out:path.join(dir,'output')};}
test('nonstandard headers map into standard fields without inventing actions',()=>{
 const row=mapEvent({'所属应用':'示例应用','页面名称':'订单页','按钮名称':'提交','动作':'点击/click','研发负责人':'开发甲','测试负责人':'测试乙','触发条件':'点击后上报',source:event.source},0);
 assert.equal(row.action,'点击');assert.equal(row.expectedName,'订单页-提交点击');assert.throws(()=>mapEvent({...event,action:'支付成功'},0),/动作须明确/);
 assert.throws(()=>mapEvent({...event,'页面名称':'其他页面'},0),/冲突/);
});
test('PRD images are preserved while platform events are still checked',async t=>{
 const x=await fixture(t,[{...event,image:{source:'prd',path:'prd.png'}}]);let imageCalls=0,eventCalls=0;
 const result=await prepareDraft(x.file,x.out,async()=>{imageCalls++;throw Error('must not run')},{findEvent:async()=>{eventCalls++;return null}});
 assert.equal(result.status,'ready');assert.equal(imageCalls,0);assert.equal(eventCalls,1);
 const prepared=JSON.parse(await fs.readFile(result.prepared));assert.equal(prepared.rows[0].image.path,path.join(x.dir,'prd.png'));assert.deepEqual(await fs.readFile(prepared.rows[0].image.path),png);
});
test('an inaccessible existing PRD image does not silently switch to platform image',async t=>{
 const x=await fixture(t,[{...event,image:{source:'prd',path:'not-downloaded.png'}}]);let lookups=0;const result=await prepareDraft(x.file,x.out,async()=>{lookups++},absent);assert.equal(result.status,'needs_review');assert.equal(lookups,0);
});
test('mixed PRD sections infer events, preserve provided images and download missing images once per exact page',async t=>{
 const x=await fixture(t,[{...event,image:{source:'prd',path:'prd.png'}},{...event,element:'返回',source:{kind:'prd-inferred',ref:'PRD C端说明第3节'}},{...event,element:'查询'}]);let calls=[];
 const result=await prepareDraft(x.file,x.out,async(app,page)=>{calls.push([app,page]);return {source:'platform',path:path.join(x.dir,'prd.png'),pageId:'p_example'}},absent);
 assert.equal(result.status,'ready');assert.deepEqual(calls,[['示例应用','订单页']]);assert.deepEqual(result.images,{prd:1,platform:2});
 const payload=JSON.parse(await fs.readFile(path.join(x.out,'review-payload.json')));assert.equal(payload.sheets[0].columns.length,10);assert.ok(payload.sheets[0].data.every(row=>row.slice(7).every(x=>x==='')));
});
test('ambiguous pages, duplicate names and unknown owners become review issues',async t=>{
 const x=await fixture(t,[event,{...event,element:'返回',developer:''},{...event,image:{source:'prd',path:'prd.png'}}]);
 const result=await prepareDraft(x.file,x.out,async()=>{throw Error('页面未唯一精确匹配')},absent);assert.equal(result.status,'needs_review');assert.equal(result.issues.length,3);assert.equal(await fs.stat(path.join(x.out,'review-payload.json')).catch(()=>null),null);
});
test('a combined raw action is not silently reduced to its first action',()=>{assert.throws(()=>mapEvent({...event,action:'点击/曝光'},0),/组合动作/)});
test('existing identities become Chinese markers and property requirements follow event ID',async t=>{
 const properties='来源：必填，取值首页/详情页。\n订单编号：按 PRD 原样上报，其他要求未说明。';
 const x=await fixture(t,[{...event,image:{source:'prd',path:'prd.png'},'自定义属性及要求':properties},{...event,element:'返回',image:{source:'prd',path:'prd.png'}}]);
 const result=await prepareDraft(x.file,x.out,()=>{throw Error('must preserve PRD image')},{findEvent:async row=>row.element==='提交'?existing(row):null});
 assert.equal(result.status,'ready');assert.equal(result.existing,1);assert.equal(result.new,1);assert.equal(result.withCustomProperties,1);
 const prepared=JSON.parse(await fs.readFile(result.prepared));assert.equal(prepared.rows[0].existingEvent.eventId,'click_example');assert.equal(prepared.rows[0].description,event.description);
 const sheet=JSON.parse(await fs.readFile(path.join(x.out,'review-payload.json'))).sheets[0];
 assert.deepEqual(sheet.columns.slice(8),['事件名称','事件标识','自定义属性及要求']);
 assert.deepEqual(sheet.data[0].slice(8),['订单页-提交点击','已存在的事件',properties]);assert.deepEqual(sheet.data[1].slice(8),['','','']);
 const csv=await fs.readFile(path.join(x.out,'review.csv'),'utf8');assert.ok(csv.includes(properties));assert.ok(csv.includes('已存在的事件'));
});
test('failed, missing, ambiguous or mismatched platform checks never classify an event as new',async t=>{
 const x=await fixture(t,[{...event,image:{source:'prd',path:'prd.png'}}]);
 for(const options of [undefined,{findEvent:async()=>undefined},{findEvent:async()=>{throw Error('同名不唯一')}},{findEvent:async row=>({...existing(row),app:'另一应用'})}]){
  const result=await prepareDraft(x.file,x.out,()=>{throw Error('unexpected')},options);assert.equal(result.status,'needs_review');assert.equal(result.ready,0);assert.equal(await fs.stat(path.join(x.out,'review-payload.json')).catch(()=>null),null);
 }
});
test('custom property text is preserved without inventing missing types or accepting malformed structures',()=>{
 assert.equal(mapEvent({...event,customProperties:'只说明上报来源'},0).customProperties,'只说明上报来源');
 assert.equal(mapEvent(event,0).customProperties,'');
 assert.throws(()=>mapEvent({...event,customProperties:{来源:'未知'}},0),/须为文本/);
 assert.throws(()=>mapEvent({...event,customProperties:'要求一','自定义属性':'要求二'},0),/冲突/);
});
