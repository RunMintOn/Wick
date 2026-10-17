const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const YAML=require('yaml');
const {fixture,web,reachable,cleanup}=require('./helpers.cjs');
test('autostart persists without changing current state; external edits are not overwritten',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{web:{...web(home),'x-localdeck':{title:'My Notes'}}}}));
 await manager.ensure();await manager.action('start','web');await reachable(home);
 let snapshot=await manager.snapshot();const pid=snapshot.services[0].pid;
 await manager.setAutostart('web',true,snapshot.token);
 assert.equal((await manager.snapshot()).services[0].pid,pid);
 await manager.action('stop','web');snapshot=await manager.snapshot();assert.equal(snapshot.services[0].autostart,true);
 await manager.setAutostart('web',false,snapshot.token);assert.equal((await manager.snapshot()).services[0].is_running,false);
 const stale=await manager.snapshot();await fs.appendFile(manager.config,'\n# External edit\n');
 await assert.rejects(manager.setAutostart('web',true,stale.token),/changed/);
 assert.match(await fs.readFile(manager.config,'utf8'),/External edit/);
 await manager.down();await manager.ensure();assert.equal((await manager.snapshot()).services[0].is_running,false);
 await manager.setAutostart('web',true,(await manager.snapshot()).token);
 await manager.down();await manager.ensure();await reachable(home);
 assert.equal((await manager.snapshot()).services[0].autostart,true);
});

test('source edits and apply preserve the running service; the next background start uses the new autostart policy',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const config={version:'0.5',processes:{web:web(home)}};
 await fs.writeFile(manager.config,YAML.stringify(config));
 await manager.ensure();
 assert.equal((await manager.snapshot()).services[0].is_running,false);
 await manager.action('start','web');await reachable(home);
 const pid=(await manager.snapshot()).services[0].pid;

 config.processes.web.disabled=false;
 await fs.writeFile(manager.config,YAML.stringify(config));
 await manager.apply();
 let service=(await manager.snapshot()).services[0];
 assert.equal(service.autostart,true);
 assert.equal(service.is_running,true);
 assert.equal(service.pid,pid);
 await reachable(home);

 await manager.down();await manager.ensure();await reachable(home);
 service=(await manager.snapshot()).services[0];
 assert.equal(service.is_running,true);
 assert.notEqual(service.pid,pid);
 const restartedPid=service.pid;

 config.processes.web.disabled=true;
 await fs.writeFile(manager.config,YAML.stringify(config));
 await manager.apply();
 service=(await manager.snapshot()).services[0];
 assert.equal(service.autostart,false);
 assert.equal(service.is_running,true);
 assert.equal(service.pid,restartedPid);
 await reachable(home);

 await manager.down();await manager.ensure();
 assert.equal((await manager.snapshot()).services[0].is_running,false);
});
