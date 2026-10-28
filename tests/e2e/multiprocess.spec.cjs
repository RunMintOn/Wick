const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const YAML=require('yaml');
const {fixture,web,reachable,cleanup}=require('../helpers.cjs');
test('console presents one service, dependency failures, component logs and one autostart switch',async({},testInfo)=>{
 const {home,manager}=await fixture();let app;
 try{
  const collector={...web(home,'collector'),readiness_probe:{exec:{command:'/usr/bin/true'}}};delete collector.disabled;
  const pageProcess={command:'exec /no-such-wick-page',availability:{restart:'no'},depends_on:{collector:{condition:'process_healthy'}}};
  await fs.writeFile(manager.config,YAML.stringify({version:'0.5','x-wick':{services:{neko:{title:'Neko Master',disabled:true,processes:['collector','page']}}},processes:{collector,page:pageProcess}}));
  app=await electron.launch({args:[path.join(__dirname,'../..')],env:{...process.env,WICK_HOME:home}});
  const page=await app.firstWindow();
  await expect(page.locator('[data-service]')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Neko Master'})).toBeVisible();
  await expect(page.getByLabel('Start at login')).toHaveCount(1);
  await page.locator('#action-start').click();
  await reachable(home,'collector');
  await expect(page.locator('[data-service="neko"] small')).toHaveText('Partially running');
  await expect(page.locator('[data-component="page"]')).toContainText('Failed');
  await expect(page.locator('[data-component="page"]')).toContainText('collector');
  await expect(page.locator('#action-start')).toBeEnabled();
  await page.locator('[data-component="page"]').getByRole('button',{name:'Show logs',exact:true}).click();
  await expect(page.locator('pre')).toContainText(/No such file|not found/);
  await page.getByLabel('Start at login').check();
  const pid=(await manager.snapshot()).services[0].components[0].pid;
  await expect(page.getByLabel('Start at login')).toBeChecked();
  expect((await manager.snapshot()).services[0].components[0].pid).toBe(pid);
  await page.screenshot({path:testInfo.outputPath('multiprocess-partial.png'),fullPage:true});
  await page.locator('#action-stop').click();
  // Stopping the remaining process does not erase the page's failure history.
  await expect(page.locator('#action-stop')).toBeDisabled();
  await expect.poll(async()=>(await manager.snapshot()).services[0].components.every(p=>!p.is_running)).toBe(true);
 }finally{if(app)await app.close();await cleanup(manager);}
});

test('component controls confirm impact and keep dependents running',async()=>{
 const {home,manager}=await fixture();let app;
 try{
  const collector={...web(home,'collector'),readiness_probe:{exec:{command:'/usr/bin/true'}}};delete collector.disabled;
  const pageProcess={...web(home,'page'),depends_on:{collector:{condition:'process_healthy'}}};delete pageProcess.disabled;
  await fs.writeFile(manager.config,YAML.stringify({'x-wick':{services:{neko:{title:'Neko Master',disabled:true,processes:['collector','page']}}},processes:{collector,page:pageProcess}}));
  app=await electron.launch({args:[path.join(__dirname,'../..')],env:{...process.env,WICK_HOME:home}});
  const page=await app.firstWindow();
  const collectorPanel=page.locator('[data-component="collector"]');
  const pagePanel=page.locator('[data-component="page"]');
  await pagePanel.getByRole('button',{name:'Start',exact:true}).click();await reachable(home,'page');
  await expect(collectorPanel.getByRole('button',{name:'Stop',exact:true})).toBeEnabled();
  const before=(await manager.snapshot()).services[0].components;
  await collectorPanel.getByRole('button',{name:'Stop',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Confirm process impact'});
  await expect(dialog).toContainText('page');
  await dialog.getByRole('button',{name:'Cancel'}).click();
  expect((await manager.snapshot()).services[0].components[0].pid).toBe(before[0].pid);
  await collectorPanel.getByRole('button',{name:'Restart',exact:true}).click();
  await dialog.getByRole('button',{name:'Proceed'}).click();
  await expect.poll(async()=>(await manager.snapshot()).services[0].components[0].pid).not.toBe(before[0].pid);
  await expect(collectorPanel.getByRole('button',{name:'Stop',exact:true})).toBeEnabled();
  expect((await manager.snapshot()).services[0].components[1].pid).toBe(before[1].pid);
  await collectorPanel.getByRole('button',{name:'Stop',exact:true}).click();
  await dialog.getByRole('button',{name:'Proceed'}).click();
  await expect.poll(async()=>(await manager.snapshot()).services[0].components[0].is_running).toBe(false);
  expect((await manager.snapshot()).services[0].components[1].pid).toBe(before[1].pid);
 }finally{if(app)await app.close();await cleanup(manager);}
});
