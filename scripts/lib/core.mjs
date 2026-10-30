import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
export const fields = ['app','page','element','action','developer','tester','description'];
export const headers = {app:'应用',page:'页面',element:'元素名称',action:'动作类型',developer:'开发负责人',tester:'测试负责人',description:'事件描述',image:'事件截图',eventName:'事件名称',eventId:'事件标识'};
export const requiredColumns = {app:'A',page:'B',element:'C',action:'D',developer:'E',tester:'F',description:'G',image:'H',eventName:'I',eventId:'J'};
export const actions = {点击:'click',曝光:'show',输入:'input',分享:'share'};
export function normalize(raw) {
  const r={...raw};
  for(const f of fields) r[f]=String(r[f]??'').trim();
  if(r.app.toLowerCase()==='理想汽车app') r.app='理想汽车APP';
  r.action=r.action.split('/')[0];
  const sourceElement=r.sourceElement??r.element;
  r.element=r.element.replace(/[^\p{Script=Han}A-Za-z0-9]/gu,'');
  if(r.element!==sourceElement) r.sourceElement=sourceElement;
  for(const f of fields) if(!r[f]) throw Error(`第${r.row}行缺少${headers[f]}`);
  if(!actions[r.action]) throw Error(`不支持的动作：${r.action}`);
  for(const [f,max] of Object.entries({element:15,developer:15,tester:15,description:200}))
    if(r[f].length>max) throw Error(`${headers[f]}超过${max}字符，不能自动截断`);
  r.expectedName=`${r.page}-${r.element}${r.action}`;
  r.eventName=String(r.eventName??'').trim(); r.eventId=String(r.eventId??'').trim();
  return r;
}
export function fingerprint(r) {return createHash('sha256').update(JSON.stringify(fields.map(f=>r[f]))).digest('hex');}
export async function hashImage(file) {
  if(!['.png','.jpg','.jpeg'].includes(path.extname(file).toLowerCase())) throw Error('截图必须是PNG或JPG文件');
  const bytes=await readFile(file);
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!png&&!jpg) throw Error('截图扩展名与实际内容不符，停止上传');
  return createHash('sha256').update(bytes).digest('hex');
}
export function validateConfig(c) {
  const sheet=new URL(c.sheetUrl),platform=new URL(c.platformUrl);
  if(sheet.protocol!=='https:'||!sheet.hostname.endsWith('.feishu.cn')||!/^\/(?:sheets|wiki)\//.test(sheet.pathname)) throw Error('仅支持用户明确提供的飞书表格或表格知识库链接，不接受PRD文档链接');
  if(platform.protocol!=='https:'||!(platform.hostname==='chehejia.com'||platform.hostname.endsWith('.chehejia.com'))||!/\/event\/?$/.test(platform.pathname)) throw Error('仅支持理想汽车域名下的运营平台事件管理页');
  if(!c.sheetName||!Array.isArray(c.rows)||!c.rows.length||c.rows.some(r=>!Number.isInteger(r)||r<2)||new Set(c.rows).size!==c.rows.length) throw Error('请指定不重复的数据行号（从2开始）');
  for(const [n,v] of Object.entries(c.elementOverrides??{})){
    if(!c.rows.includes(Number(n))||typeof v.source!=='string'||!v.source||typeof v.value!=='string'||v.value!==v.source.replace(/[✅-]/g,'').trim()) throw Error('名称修正超出已批准的符号清理范围');
  }
  if(Object.entries(requiredColumns).some(([key,column])=>c.columns?.[key]!==column)) throw Error('列映射必须严格使用模板A–J，拒绝向其他列读写');
}
export function verifyRecord(row,record) {
  if(!record||record.eventName!==row.expectedName||!new RegExp(`^${actions[row.action]}_[A-Za-z0-9]+$`).test(record.eventId)) throw Error('事件名称或标识不匹配，停止回写');
  for(const k of ['page','element','action','developer','tester','description']) if(record[k]!==row[k]) throw Error(`已有事件${headers[k]}与表格不同，需人工核查`);
  if(row.eventId&&row.eventId!==record.eventId) throw Error('表格已有事件标识与平台不一致');
  if(row.eventName&&row.eventName!==record.eventName) throw Error('表格已有事件名称与平台不一致');
  return record;
}
export function shouldSkipRecorded(result,entry) {
  const pending=entry?.phase==='submitting'||entry?.phase==='verified';
  return Boolean(String(result.eventName??'').trim()||String(result.eventId??'').trim())&&!pending;
}
// Known incomplete submissions may recover writeback; unrelated existing events are skipped.
export async function processRow({row,mode,platform,sheet,journal,entry}) {
  const pending=['submitting','verified'].includes(entry?.phase);
  let record=await platform.find(row,row.eventId||entry?.record?.eventId||row.expectedName,{verify:pending});
  if(record) {
    if(!pending) return {status:mode==='check'?'existing':'skipped_existing',record};
    verifyRecord(row,record);
    if(mode==='check') return {status:'existing',record};
    await journal({phase:'verified',record});
    await sheet.writeResult(row,record);
    await journal({phase:'done',record});
    return {status:'reused',record};
  }
  if(row.eventId||row.eventName||entry?.phase==='submitting'||entry?.record) throw Error('已记录过事件或提交状态不确定，但平台未找到；禁止重复创建');
  if(mode==='check') {await platform.inspectOptions(row); return {status:'ready'};}
  await sheet.assertUnchanged(row);
  await platform.prepare(row);
  await sheet.assertUnchanged(row);
  await journal({phase:'submitting'}); // written before the click; never blindly retry it
  await platform.submit();
  record=await platform.find(row,row.expectedName);
  verifyRecord(row,record);
  await journal({phase:'verified',record});
  await sheet.writeResult(row,record);
  await journal({phase:'done',record});
  return {status:'created',record};
}
