const {test,expect}=require('@playwright/test');const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {readServer}=require('./_helpers.cjs');const token=()=>fs.readFileSync(path.join(readServer().projectDir,'runtime/dsh-token'),'utf8').trim();
test.beforeEach(async({page})=>{await page.goto(readServer().url+'#guard-token='+encodeURIComponent(token()));await expect(page.getByTestId('dsh-host-panel')).toBeVisible();});
test('DSH login removes fragment and shows actual PMKB',async({page})=>{expect(new URL(page.url()).hash).toBe('');await page.click('a.nav-btn[href="/rules"]');await expect(page.locator('.rule-card')).toHaveCount(79);await expect(page.locator('.rule-card').filter({hasText:'P1-FILE-READ'})).toBeVisible();});
test('DSH scan exports reports and local semantic mode works',async({page})=>{
  await page.click('a.nav-btn[href="/settings"]');await page.click('#run-baseline');await expect(page.locator('#run-baseline')).toBeEnabled();
  const response=await page.request.get(new URL('/api/dsh/reports/json',readServer().url).toString());expect(response.ok()).toBeTruthy();expect((await response.json()).checks.every(c=>c.check_id.startsWith('DSH-'))).toBeTruthy();
  await page.getByLabel('DSH 语义模式').selectOption('local');await expect(page.getByTestId('dsh-host-panel')).toContainText('未启用，使用本地分析');
});
test('DSH native approval sync is read only',async({page,request})=>{
  const server=readServer(),id=crypto.randomUUID(),call={protocol:'dsh-guard-v2',instance_id:'dsh-local',session_id:id,agent_id:id,call_id:id,root_call_id:id,tool_name:'write',cwd:server.workspace,arguments:{file_path:'output-'+id+'.txt',content:'test'}};
  const post=(endpoint,data)=>request.post(new URL('/api/dsh/'+endpoint,server.url).toString(),{headers:{'x-rvguarder-token':token()},data});
  const response=await post('before',call);expect(response.ok()).toBeTruthy();const decision=await response.json();expect(decision.kind).toBe('ask');
  await page.click('a.nav-btn[href="/actions"]');
  await expect(page.locator('.approval-card').filter({hasText:'请在 DSH 原生审批处理'}).first()).toBeVisible();await expect(page.locator('.approve-action')).toHaveCount(0);
  expect((await post('dispatch',call)).ok()).toBeTruthy();expect((await post('result',{call,dispatched:true,succeeded:true})).ok()).toBeTruthy();
  await expect.poll(async()=>{const r=await page.request.get(new URL('/api/actions/'+decision.action_id,server.url).toString());return(await r.json()).action.execution_state;}).toBe('executed');
});
test('DSH hides unsupported clear and skill controls',async({page,request})=>{
  const server=readServer(),id=crypto.randomUUID();
  const response=await request.post(new URL('/api/dsh/before',server.url).toString(),{headers:{'x-rvguarder-token':token()},data:{protocol:'dsh-guard-v2',instance_id:'dsh-local',session_id:id,agent_id:id,call_id:id,root_call_id:id,tool_name:'read',cwd:server.workspace,arguments:{file_path:'data.txt'}}});
  expect(response.ok()).toBeTruthy();await page.reload();await expect(page.getByTestId('dsh-host-panel')).toBeVisible();
  await expect(page.locator('#clear-actions')).toHaveCount(0);await expect(page.locator('a.nav-btn[href="/skills"]')).toHaveCount(0);
  await expect(page.getByTestId('dsh-capabilities')).toContainText('降级审计事件');
});
