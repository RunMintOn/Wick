const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const YAML=require('yaml');
const {fixture,web,reachable,cleanup,waitFor,exec}=require('../helpers.cjs');
const root=path.join(__dirname,'../..');
test('control a real service, then quit and reopen without stopping it',async({},testInfo)=>{
  const {home,manager}=await fixture();let app;
  try{
    await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{web:web(home)}}));
    app=await electron.launch({args:[root],env:{...process.env,LOCALDECK_HOME:home}});
    let page=await app.firstWindow();
    await page.emulateMedia({colorScheme:null});
    await page.locator('[data-service="web"]').click();
    await expect(page.locator('#background-label')).toHaveText('Connected');
    await page.getByRole('button',{name:'Start',exact:true}).click();await reachable(home);
    await expect(page.locator('#detail')).toContainText('Running');
    await expect(page.locator('#detail')).toContainText('Memory');
    await page.getByRole('button',{name:'Show logs',exact:true}).click();
    await expect(page.locator('pre')).toContainText('Listening on');
    await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='light';});
    await page.screenshot({path:testInfo.outputPath('console-light.png')});
    await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='dark';});
    await expect.poll(()=>page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('console-dark.png')});
    const pid=(await manager.snapshot()).services[0].pid;
    await page.getByLabel('Start at login').check();
    await expect(page.getByLabel('Start at login')).toBeChecked();
    expect((await manager.snapshot()).services[0].pid).toBe(pid);
    await app.close();app=null;await reachable(home);
    app=await electron.launch({args:[root],env:{...process.env,LOCALDECK_HOME:home}});page=await app.firstWindow();
    await expect(page.locator('#detail')).toContainText('Running');
    expect((await manager.snapshot()).services[0].pid).toBe(pid);
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await expect(page.locator('#detail')).toContainText('Stopped');
    await waitFor(async()=>!(await manager.snapshot()).services[0].is_running);
    await exec(manager.binary,['-U','-u',manager.socket,'process','start','web']);await reachable(home);
    await expect(page.locator('#detail')).toContainText('Running');
    const current=(await manager.snapshot()).services[0].pid;
    const original=await fs.readFile(manager.config,'utf8');await fs.writeFile(manager.config,'processes: [broken');
    await expect(page.getByRole('alert')).toContainText(/configuration unavailable/i);await reachable(home);
    await expect(page.locator('#background-label')).toHaveText('Connected');
    await fs.writeFile(manager.config,original);await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(page.locator('#detail')).toContainText('Running');expect((await manager.snapshot()).services[0].pid).toBe(current);
    await manager.down();await expect(page.getByRole('alert')).toContainText(/unavailable/i);
    await expect(page.locator('#background-label')).toHaveText('Unavailable');
    await page.getByRole('button',{name:'Reconnect',exact:true}).click();await reachable(home);
    await expect(page.locator('#detail')).toContainText('Running');
    await expect(page.locator('#background-label')).toHaveText('Connected');
  }finally{if(app)await app.close();await cleanup(manager);}
});

test('stop remains available during crash backoff and cancels automatic recovery',async()=>{
 const {home,manager}=await fixture();let app;
 try{
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{broken:{command:'exec /no-such-localdeck-program',disabled:true,availability:{restart:'on_failure',max_restarts:3,backoff_seconds:4}}}}));
  app=await electron.launch({args:[root],env:{...process.env,LOCALDECK_HOME:home}});const page=await app.firstWindow();
  await page.locator('[data-service="broken"]').click();await page.getByRole('button',{name:'Start',exact:true}).click();
  await expect(page.locator('#detail')).toContainText('Restarting');
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await waitFor(async()=>!(await manager.snapshot()).services[0].is_running);
  const state=(await manager.snapshot()).services[0];await page.waitForTimeout(4500);
  const after=(await manager.snapshot()).services[0];expect(after.is_running).toBe(false);expect(after.restarts).toBe(state.restarts);
  await page.getByRole('button',{name:'Show logs',exact:true}).click();await expect(page.locator('pre')).toContainText('No such file');
 }finally{if(app)await app.close();await cleanup(manager);}
});

test('browser entry belongs to Address, separate from service controls',async()=>{
 const {home,manager}=await fixture();let app;
 const url='http://127.0.0.1:54321/notes?view=all';
 try{
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{web:{...web(home),'x-localdeck':{title:'Notes',url}}}}));
  app=await electron.launch({args:[root],env:{...process.env,LOCALDECK_HOME:home}});const page=await app.firstWindow();
  await page.locator('[data-service="web"]').click();
  await expect(page.locator('.actions button')).toHaveCount(3);
  const address=page.locator('.row').filter({has:page.getByText('Address',{exact:true})});
  const open=address.getByRole('button',{name:/Open in Browser/});await expect(open).toBeVisible();
  await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.openedBrowserURL=url;};});
  await open.click();
  await expect.poll(()=>app.evaluate(()=>globalThis.openedBrowserURL)).toBe(url);
 }finally{if(app)await app.close();await cleanup(manager);}
});
