const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const YAML=require('yaml');
const {fixture,web,reachable,cleanup,waitFor}=require('./helpers.cjs');
function config(home){
 const data={version:'0.5','x-wick':{services:{neko:{title:'Neko Master',disabled:true,processes:['collector','page']}}},processes:{
  collector:{...web(home,'collector'),readiness_probe:{exec:{command:`test -f "${path.join(home,'ready')}"`},initial_delay_seconds:0,period_seconds:1,timeout_seconds:1,failure_threshold:60,success_threshold:1}},
  page:{...web(home,'page'),depends_on:{collector:{condition:'process_healthy'}}},
  other:web(home,'other')
 }};
 delete data.processes.collector.disabled;delete data.processes.page.disabled;
 return data;
}
test('one service starts dependencies, keeps unrelated PIDs, and applies one autostart policy',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const data=config(home);await fs.writeFile(manager.config,YAML.stringify(data));
 await manager.ensure();await manager.action('start','other');await reachable(home,'other');
 const pid=(await manager.snapshot()).services.find(s=>s.name==='other').pid;
 let snapshot=await manager.snapshot();
 assert.deepEqual(snapshot.services.map(s=>s.name),['neko','other']);
 assert.deepEqual(snapshot.services[0].components.map(p=>p.name),['collector','page']);
 const starting=manager.action('start','neko');starting.catch(()=>{});
 await reachable(home,'collector');
 assert.equal((await manager.snapshot()).services[0].components[1].is_running,false);
 await fs.writeFile(path.join(home,'ready'),'yes');
 await starting;await reachable(home,'page');
 snapshot=await manager.snapshot();assert.equal(snapshot.services[0].status,'Running');
 const collectorPid=snapshot.services[0].components[0].pid;
 await manager.action('start','neko');
 assert.equal((await manager.snapshot()).services[0].components[0].pid,collectorPid);
 await manager.setAutostart('neko',true,(await manager.snapshot()).token);await manager.apply();
 snapshot=await manager.snapshot();
 assert.equal(snapshot.services[0].autostart,true);
 assert.equal(snapshot.services[0].components[0].pid,collectorPid);
 assert.equal(snapshot.services.find(s=>s.name==='other').pid,pid);
 await manager.action('stop','neko');
 assert.equal((await manager.snapshot()).services[0].status,'Stopped');
 await manager.down();await manager.ensure();await reachable(home,'collector');await reachable(home,'page');
 await waitFor(async()=>(await manager.snapshot()).services[0].status==='Running');
 await manager.setAutostart('neko',false,(await manager.snapshot()).token);await manager.apply();
 await manager.down();await manager.ensure();
 assert.equal((await manager.snapshot()).services[0].status,'Stopped');
});
test('partial startup retains running components, skips dependents, continues other branches, and retries only missing processes',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const data=config(home);
 data.processes.page.command='exec /no-such-wick-component';
 data.processes.page.availability={restart:'no'};
 data.processes.worker={...web(home,'worker'),readiness_probe:{exec:{command:'/usr/bin/true'}}};delete data.processes.worker.disabled;
 data.processes.downstream={...web(home,'downstream'),depends_on:{page:{condition:'process_healthy'}}};delete data.processes.downstream.disabled;
 data.processes.page.readiness_probe={exec:{command:'/usr/bin/true'}};
 data['x-wick'].services.neko.processes.push('downstream','worker');
 await fs.writeFile(path.join(home,'ready'),'yes');
 await fs.writeFile(manager.config,YAML.stringify(data));await manager.ensure();
 await assert.rejects(manager.action('start','neko'),/page.*|downstream/s);
 await reachable(home,'collector');await reachable(home,'worker');
 let service=(await manager.snapshot()).services[0];
 assert.equal(service.status,'Partially running');
 assert.equal(service.components.find(p=>p.name==='downstream').is_running,false);
 const pid=service.components[0].pid;
 data.processes.page.command=web(home,'page').command;
 await fs.writeFile(manager.config,YAML.stringify(data));await manager.apply();
 await manager.action('start','neko');await reachable(home,'downstream');
 service=(await manager.snapshot()).services[0];
 assert.equal(service.status,'Running');assert.equal(service.components[0].pid,pid);
 process.kill(service.components.find(p=>p.name==='page').pid,'SIGKILL');
 await waitFor(async()=>(await manager.snapshot()).services[0].status==='Partially running');
 assert.equal((await manager.snapshot()).services[0].components.find(p=>p.name==='downstream').is_running,true);
 await manager.action('stop','neko');assert.equal((await manager.snapshot()).services[0].status,'Stopped');
});

test('invalid membership and dependency graphs are rejected before touching running services',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const data=config(home);
 await fs.writeFile(manager.config,YAML.stringify(data));await manager.ensure();
 await manager.action('start','other');await reachable(home,'other');
 const pid=(await manager.snapshot()).services.find(s=>s.name==='other').pid;
 const cases=[
  [d=>{d['x-wick'].services.duplicate={disabled:true,processes:['collector']};},/more than one/],
  [d=>{d.processes.page.depends_on={missing:{condition:'process_healthy'}};},/unknown dependency/],
  [d=>{d.processes.page.readiness_probe={exec:{command:'/usr/bin/true'}};d.processes.collector.depends_on={page:{condition:'process_healthy'}};},/cycle/],
  [d=>{d.processes.page.depends_on={other:{condition:'process_healthy'}};},/same service/],
  [d=>{d.processes.collector.disabled=false;},/on its service/],
 ];
 for(const [change,pattern] of cases){
  const invalid=structuredClone(data);change(invalid);
  await fs.writeFile(manager.config,YAML.stringify(invalid));
  await assert.rejects(manager.apply(),pattern);
  assert.equal((await manager.request('/process/other')).pid,pid);await reachable(home,'other');
 }
});

test('autostart dependency failure never launches the page and remains diagnosable',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const data=config(home);data['x-wick'].services.neko.disabled=false;
 data.processes.collector.command='exec /no-such-wick-collector';data.processes.collector.availability={restart:'no'};
 await fs.writeFile(manager.config,YAML.stringify(data));await manager.ensure();
 await waitFor(async()=>{
  const s=(await manager.snapshot()).services[0];
  return s.components[0].displayStatus==='Failed';
 });
 const service=(await manager.snapshot()).services[0];
 assert.notEqual(service.status,'Running');
 assert.equal(service.components[1].is_running,false);
 assert.deepEqual(service.components[1].blockedBy,['collector']);
 assert.match(await manager.logs('collector'),/No such file|not found/);
 await manager.action('stop','neko');
 assert.equal((await manager.snapshot()).services[0].components.some(p=>p.is_running),false);
});

test('whole stop waits for each dependent to exit before stopping its dependency',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const data=config(home);await fs.writeFile(path.join(home,'ready'),'yes');
 for(const name of ['collector','page']){
  const script=`const fs=require("node:fs");process.on("SIGTERM",()=>{fs.appendFileSync(${JSON.stringify(path.join(home,'stops'))},${JSON.stringify(name+'\n')});setTimeout(()=>process.exit(0),150);});require(${JSON.stringify(path.join(__dirname,'web.cjs'))});`;
  data.processes[name].command=`exec "${process.execPath}" -e '${script}' "${home}" "${name}"`;
 }
 // -e has no script argument; supply the fixture's expected argv positions.
 for(const name of ['collector','page'])data.processes[name].command=data.processes[name].command.replace('const fs=', 'process.argv.splice(1,0,"web.cjs");const fs=');
 await fs.writeFile(manager.config,YAML.stringify(data));await manager.ensure();
 await manager.action('start','neko');await reachable(home,'page');
 await manager.action('stop','neko');
 assert.equal(await fs.readFile(path.join(home,'stops'),'utf8'),'page\ncollector\n');
});

test('a failed stop is reported but does not prevent attempts to stop other components',async t=>{
 const {home,manager}=await fixture();const binary=manager.binary;t.after(async()=>{manager.binary=binary;await cleanup(manager);});
 const data=config(home);await fs.writeFile(path.join(home,'ready'),'yes');
 await fs.writeFile(manager.config,YAML.stringify(data));await manager.ensure();await manager.action('start','neko');
 // Inject an actual CLI failure at the external executable boundary.
 const wrapper=path.join(home,'pc.cjs');
 await fs.writeFile(wrapper,`#!${process.execPath}\nconst args=process.argv.slice(2);if(args.includes("stop")&&args.at(-1)==="page"){console.error("simulated stop failure");process.exit(7);}const r=require("node:child_process").spawnSync(${JSON.stringify(binary)},args,{stdio:"inherit"});process.exit(r.status??1);\n`,{mode:0o700});
 manager.binary=wrapper;
 await assert.rejects(manager.action('stop','neko'),/page.*simulated stop failure/s);
 const service=(await manager.snapshot()).services[0];
 assert.equal(service.components[0].is_running,false);
 assert.equal(service.components[1].is_running,true);
});

test('readiness timeout keeps its process for diagnosis and a later start can finish',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const data=config(home);data.processes.collector['x-wick']={ready_timeout_seconds:1};
 await fs.writeFile(manager.config,YAML.stringify(data));await manager.ensure();
 await assert.rejects(manager.action('start','neko'),/collector.*timed out.*page.*dependency/s);
 let service=(await manager.snapshot()).services[0];const pid=service.components[0].pid;
 assert.equal(service.components[0].is_running,true);assert.equal(service.components[1].is_running,false);
 await fs.writeFile(path.join(home,'ready'),'yes');
 await waitFor(async()=>(await manager.snapshot()).services[0].components[0].is_ready==='Ready');
 await manager.action('start','neko');await reachable(home,'page');
 service=(await manager.snapshot()).services[0];assert.equal(service.status,'Running');assert.equal(service.components[0].pid,pid);
});
