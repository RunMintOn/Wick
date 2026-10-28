const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const YAML=require('yaml');
const {fixture,web,reachable,cleanup,waitFor,exec}=require('../helpers.cjs');
const root=path.join(__dirname,'../..');
test('SIGTERM exit after Stop is Stopped; an application error remains Failed',async()=>{
 const {home,manager}=await fixture();let app;
 try{
  const script=`process.argv.splice(1,0,"web.cjs");process.on("SIGTERM",()=>process.exit(143));require(${JSON.stringify(path.join(__dirname,'../web.cjs'))});`;
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{
   web:{...web(home),command:`exec "${process.execPath}" -e '${script}' "${home}" web`},
   broken:{command:`exec "${process.execPath}" -e 'process.exit(7)'`,disabled:true,availability:{restart:'no'}}
  }}));
  app=await electron.launch({args:[root],env:{...process.env,WICK_HOME:home}});
  const page=await app.firstWindow();
  await page.locator('[data-service="web"]').click();
  await page.getByRole('button',{name:'Start',exact:true}).click();await reachable(home);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await waitFor(async()=>{
   const service=(await manager.snapshot()).services.find(s=>s.name==='web');
   return !service.is_running&&service.exit_code===143;
  });
  await expect(page.locator('[data-service="web"] small')).toHaveText('Stopped');
  await expect(page.locator('[data-service="web"] .dot')).not.toHaveClass(/failed/);
  await expect(page.locator('.machine .state')).toHaveText('Stopped');
  await app.close();app=null;
  app=await electron.launch({args:[root],env:{...process.env,WICK_HOME:home}});
  const reopened=await app.firstWindow();
  await expect(reopened.locator('[data-service="web"] small')).toHaveText('Stopped');
  await reopened.locator('[data-service="broken"]').click();
  await reopened.getByRole('button',{name:'Start',exact:true}).click();
  await expect(reopened.locator('[data-service="broken"] small')).toHaveText('Failed');
  await expect(reopened.locator('[data-service="broken"] .dot')).toHaveClass(/failed/);
 }finally{if(app)await app.close();await cleanup(manager);}
});

test('control a real service, then quit and reopen without stopping it',async({},testInfo)=>{
  const {home,manager}=await fixture();let app;
  try{
    await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{web:web(home)}}));
    app=await electron.launch({args:[root],env:{...process.env,WICK_HOME:home}});
    let page=await app.firstWindow();
    await page.locator('[data-service="web"]').click();
    await expect(page.locator('#background-label')).toHaveText('Connected');
    await page.getByRole('button',{name:'Start',exact:true}).click();await reachable(home);
    await expect(page.locator('.machine .state')).toHaveText('Running');
    await expect(page.locator('#detail')).toContainText('Memory');
    await expect(page.locator('.stat').filter({has:page.getByText('Uptime',{exact:true})}).locator('b')).toHaveText(/^\d/);
    await expect(page.locator('.stats')).not.toContainText('Exit code');
    await page.getByRole('button',{name:'Show logs',exact:true}).click();
    await expect(page.locator('pre')).toContainText('Listening on');
    await page.screenshot({path:testInfo.outputPath('console-dark.png')});
    const pid=(await manager.snapshot()).services[0].pid;
    await page.getByLabel('Start at login').check();
    await expect(page.getByLabel('Start at login')).toBeChecked();
    expect((await manager.snapshot()).services[0].pid).toBe(pid);
    await app.close();app=null;await reachable(home);
    app=await electron.launch({args:[root],env:{...process.env,WICK_HOME:home}});page=await app.firstWindow();
    await expect(page.locator('.machine .state')).toHaveText('Running');
    await expect(page.locator('.stat').filter({has:page.getByText('Uptime',{exact:true})}).locator('b')).toHaveText(/^\d/);
    expect((await manager.snapshot()).services[0].pid).toBe(pid);
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await expect(page.locator('#detail')).toContainText('Stopped');
    await expect(page.locator('.stats')).toContainText('Exit code');
    await expect(page.locator('.stats')).not.toContainText('Uptime');
    await waitFor(async()=>!(await manager.snapshot()).services[0].is_running);
    await exec(manager.binary,['-U','-u',manager.socket,'process','start','web']);await reachable(home);
    await expect(page.locator('.machine .state')).toHaveText('Running');
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
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{broken:{command:'exec /no-such-wick-program',disabled:true,availability:{restart:'on_failure',max_restarts:3,backoff_seconds:4}}}}));
  app=await electron.launch({args:[root],env:{...process.env,WICK_HOME:home}});const page=await app.firstWindow();
  await page.locator('[data-service="broken"]').click();await page.getByRole('button',{name:'Start',exact:true}).click();
  await expect(page.locator('#detail')).toContainText('Restarting');
  await expect(page.locator('#summary')).toContainText('1 starting');
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
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{web:{...web(home),'x-wick':{title:'Notes',url}}}}));
  app=await electron.launch({args:[root],env:{...process.env,WICK_HOME:home}});const page=await app.firstWindow();
  await page.locator('[data-service="web"]').click();
  await expect(page.locator('.actions button')).toHaveCount(3);
  const address=page.locator('.addr');
  const open=address.getByRole('button',{name:/Open in Browser/});await expect(open).toBeVisible();
  await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.openedBrowserURL=url;};});
  await open.click();
  await expect.poll(()=>app.evaluate(()=>globalThis.openedBrowserURL)).toBe(url);
 }finally{if(app)await app.close();await cleanup(manager);}
});

test('service selection animates the health band, but polling leaves it settled',async({},testInfo)=>{
 const {home,manager}=await fixture();let app;
 try{
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{web:web(home),other:web(home,'other')}}));
  app=await electron.launch({args:[root],env:{...process.env,WICK_HOME:home}});
  const page=await app.firstWindow();
  await expect(page.locator('#band i')).toHaveCount(2);
  await page.locator('#band').evaluate(node=>{window.bandStarts=0;node.addEventListener('animationstart',()=>window.bandStarts++);});
  await page.locator('[data-service="other"]').click();
  await expect(page.locator('#detail h1')).toHaveText('other');
  await expect.poll(()=>page.evaluate(()=>window.bandStarts)).toBeGreaterThanOrEqual(2);
  await expect.poll(()=>page.locator('#band').evaluate(node=>node.getAnimations({subtree:true}).filter(a=>a.playState==='running').length)).toBe(0);
  // A real polling cycle must neither replace the band nor restart its animation.
  await page.locator('#band i').first().evaluate(node=>{window.settledBand=node;});
  await page.waitForTimeout(2400);
  expect(await page.locator('#band i').first().evaluate(node=>node===window.settledBand)).toBe(true);
  await expect(page.locator('.stats')).toContainText('Exit code');
  await page.setViewportSize({width:720,height:500});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('console-720.png')});
 }finally{if(app)await app.close();await cleanup(manager);}
});

test('service distribution stays readable with 11 and 40 registrations, then clears when empty',async({},testInfo)=>{
 const {home,manager}=await fixture();let app;
 try{
  const processes=Object.fromEntries(Array.from({length:11},(_,i)=>[`service-${i}`,{
   ...web(home,`service-${i}`),'x-wick':{title:i===0?'Notes <local>':`Service ${i}`,url:'http://127.0.0.1:54321'}
  }]));
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes}));
  app=await electron.launch({args:[root],env:{...process.env,WICK_HOME:home}});
  const page=await app.firstWindow(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await expect(page.locator('[data-service]')).toHaveCount(11);
  await expect(page.locator('#band i')).toHaveCount(11);
  await expect(page.locator('#detail h1')).toHaveText('Notes <local>');
  await page.setViewportSize({width:1440,height:900});
  await expect.poll(()=>page.locator('#band').evaluate(node=>node.getAnimations({subtree:true}).filter(a=>a.playState==='running').length)).toBe(0);
  await page.screenshot({path:testInfo.outputPath('console-11-wide.png')});
  for(let i=11;i<40;i++)processes[`service-${i}`]={...web(home,`service-${i}`)};
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('[data-service]')).toHaveCount(40);
  await expect(page.locator('#band i')).toHaveCount(1);
  await expect(page.locator('#summary')).toContainText('40 stopped');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-service="service-10"]').click();
  expect(await page.locator('#band').evaluate(node=>node.getAnimations({subtree:true}).length)).toBe(0);
  await page.setViewportSize({width:720,height:500});
  expect(await page.locator('.scroll').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('console-40-small.png')});
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{}}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your local services'})).toBeVisible();
  await expect(page.locator('[data-service]')).toHaveCount(0);
  await expect(page.locator('#band i')).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{if(app)await app.close();await cleanup(manager);}
});

test('health checks show real results only when configured and running',async({},testInfo)=>{
 const {home,manager}=await fixture();let app;
 try{
  const flag=path.join(home,'ready');
  await fs.writeFile(flag,'waiting');
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{
   checked:{...web(home,'checked'),readiness_probe:{
    exec:{command:`grep -q '^ready$' "${flag}"`},initial_delay_seconds:3,period_seconds:1,failure_threshold:120
   }},
   plain:web(home,'plain')
  }}));
  app=await electron.launch({args:[root],env:{...process.env,WICK_HOME:home}});
  const page=await app.firstWindow();
  await page.locator('[data-service="checked"]').click();
  await expect(page.locator('.health-check')).toHaveCount(0);
  await expect(page.locator('.stats')).not.toContainText('CPU');
  await expect(page.locator('.addr')).toHaveCount(0);
  await page.locator('#action-start').click();await reachable(home,'checked');
  await expect(page.locator('.health-check')).toHaveText('Health check: Checking');
  await expect(page.locator('.machine .state')).toHaveText('Starting');
  await expect(page.locator('.health-check')).toHaveText('Health check: Failed');
  await expect(page.locator('.machine .state')).toHaveText('Unhealthy');
  await fs.writeFile(flag,'ready');
  await expect(page.locator('.health-check')).toHaveText('Health check: Passed');
  await expect(page.locator('.machine .state')).toHaveText('Running');
  await expect(page.locator('.machine')).not.toContainText('·');
  await page.screenshot({path:testInfo.outputPath('health-check-passed.png')});
  await page.locator('[data-service="plain"]').click();
  await page.locator('#action-start').click();await reachable(home,'plain');
  await expect(page.locator('.machine .state')).toHaveText('Running');
  await expect(page.locator('.health-check')).toHaveCount(0);
  await page.locator('[data-service="checked"]').click();
  await page.locator('#action-stop').click();
  await expect(page.locator('.machine .state')).toHaveText('Stopped');
  await expect(page.locator('.health-check')).toHaveCount(0);
  await expect(page.locator('.stats')).not.toContainText('CPU');
 }finally{if(app)await app.close();await cleanup(manager);}
});
