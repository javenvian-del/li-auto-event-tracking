import test from 'node:test';import assert from 'node:assert/strict';
import {Platform} from '../scripts/lib/platform.mjs';import {normalize,shouldSkipRecorded} from '../scripts/lib/core.mjs';
const row=normalize({row:2,app:'示例应用',page:'示例页',element:'提交',action:'点击',developer:'开发甲',tester:'测试乙',description:'本期说明'});
const record={...row,eventName:row.expectedName,eventId:'click_example',developer:'原开发',tester:'原测试',description:'旧版说明'};
test('existing event lookup accepts changed PRD wording and owners but demands the same identity',async()=>{
 const platform=new Platform(null);let query;
 platform.findAll=async(...args)=>{query=args;return [record]};assert.equal((await platform.findExisting(row)).eventId,'click_example');assert.deepEqual(query,[row,row.expectedName,1,false]);
 for(const changed of [{...record,app:'其他应用'},{...record,page:'其他页面'},{...record,element:'返回'},{...record,action:'曝光'},{...record,eventId:'show_example'},{...record,eventName:'相似名称'}]){platform.findAll=async()=>[changed];await assert.rejects(platform.findExisting(row),/精确匹配/)}
 platform.findAll=async()=>[record,record];await assert.rejects(platform.findExisting(row),/唯一匹配/);
 platform.findAll=async()=>[];assert.equal(await platform.findExisting(row),null);
});
test('the Chinese existing marker is skipped by the batch before creating or writing results',()=>{
 assert.equal(shouldSkipRecorded({eventName:row.expectedName,eventId:'已存在的事件'}),true);assert.equal(shouldSkipRecorded({eventId:'已存在的事件'}),true);assert.equal(shouldSkipRecorded({eventName:'',eventId:''}),false);
});
