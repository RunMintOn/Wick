const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const YAML=require('yaml');
const {fixture,web,reachable,cleanup,waitFor,exec}=require('./helpers.cjs');
test('isolated takeover releases old ports, reuses SQLite data, and preserves unrelated PIDs',async t=>{
 const {home,manager}=await fixture();const old=[];
 t.after(async()=>{for(const child of old)if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}await cleanup(manager);});
 const database=path.join(home,'data.sqlite');
 await exec('/usr/bin/sqlite3',[database,"CREATE TABLE samples(value TEXT); INSERT INTO samples VALUES('existing-user-data');"]);
 const script=path.join(__dirname,'takeover-worker.cjs');
 for(const name of ['collector','page']){
  const child=spawn(process.execPath,[script,home,name],{stdio:'ignore'});old.push(child);
  await reachable(home,name);
 }
 const collectorPort=(await fs.readFile(path.join(home,'collector.port'),'utf8')).trim();
 const pagePort=(await fs.readFile(path.join(home,'page.port'),'utf8')).trim();
 const data={version:'0.5',processes:{other:web(home,'other')}};
 await fs.writeFile(manager.config,YAML.stringify(data));await manager.ensure();
 await manager.action('start','other');await reachable(home,'other');
 const otherPid=(await manager.snapshot()).services[0].pid;
 const target={
  ...data,'x-wick':{services:{neko:{disabled:true,processes:['collector','page']}}},
  processes:{...data.processes,
   collector:{command:`exec "${process.execPath}" "${script}" "${home}" collector ${collectorPort}`,availability:{restart:'no'},readiness_probe:{http_get:{host:'127.0.0.1',port:Number(collectorPort),path:'/'},initial_delay_seconds:1,period_seconds:1}},
   page:{command:`exec "${process.execPath}" "${script}" "${home}" page ${pagePort}`,availability:{restart:'no'},depends_on:{collector:{condition:'process_healthy'}}}
  }
 };
 // Preparing registration must not touch either old listener.
 await fs.writeFile(manager.config,YAML.stringify(target));await manager.apply();
 assert.equal((await fetch(`http://127.0.0.1:${pagePort}`)).status,200);
 assert.equal((await manager.snapshot()).services[0].components.some(p=>p.is_running),false);
 // An attempted premature switch fails without stopping the old instances or deleting data.
 await assert.rejects(manager.action('start','neko'));
 assert.equal(await(await fetch(`http://127.0.0.1:${pagePort}`)).text(),'2');
 assert.equal(old.every(child=>child.exitCode===null),true);
 for(const child of [...old].reverse()){const done=once(child,'exit');child.kill();await done;}
 for(const port of [collectorPort,pagePort])await waitFor(async()=>{try{await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(300)});return false;}catch{return true;}});
 await manager.action('start','neko');
 assert.equal(await(await fetch(`http://127.0.0.1:${pagePort}`)).text(),'3');
 assert.equal((await exec('/usr/bin/sqlite3',[database,'PRAGMA integrity_check;'])).stdout.trim(),'ok');
 assert.equal((await exec('/usr/bin/sqlite3',[database,"SELECT COUNT(*) FROM samples WHERE value='existing-user-data';"])).stdout.trim(),'1');
 const snapshot=await manager.snapshot();
 assert.equal(snapshot.services.find(s=>s.name==='other').pid,otherPid);
 await manager.setAutostart('neko',true,snapshot.token);await manager.apply();
 assert.equal((await manager.snapshot()).services[0].autostart,true);
 assert.equal((await manager.snapshot()).services.find(s=>s.name==='other').pid,otherPid);
});
