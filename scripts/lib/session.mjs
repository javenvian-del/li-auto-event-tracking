// A read-only readiness check for both authenticated applications.
export async function checkSessions(sheetPage,platformPage,timeout=15000) {
  const checks=await Promise.allSettled([
    sheetPage.getByRole('main').getByRole('textbox').waitFor({state:'visible',timeout}),
    platformPage.getByRole('textbox',{name:'请选择应用',exact:true}).waitFor({state:'visible',timeout})
  ]);
  const result={feishu:checks[0].status==='fulfilled'?'ready':'unavailable',platform:checks[1].status==='fulfilled'?'ready':'unavailable'};
  if(Object.values(result).some(x=>x!=='ready')) {
    const e=Error(`登录或页面就绪检查未通过：飞书=${result.feishu}，运营平台=${result.platform}。请在脚本专用浏览器登录两端后重试。`);
    e.sessions=result;throw e;
  }
  return result;
}
