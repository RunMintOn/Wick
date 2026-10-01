const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const YAML=require('yaml');
const {fixture,web,reachable,cleanup,waitFor}=require('./helpers.cjs');
test('show bounded recent logs and real resource metrics',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 await fs.writeFile(manager.config,YAML.stringify({version:'0.5',log_length:500,processes:{web:web(home),logs:{command:`"${process.execPath}" -e 'for(let i=0;i<1000;i++)console.log("line-"+i)'`,disabled:true}}}));
 await manager.ensure();await manager.action('start','web');await reachable(home);
 await waitFor(async()=>{const s=(await manager.snapshot()).services.find(s=>s.name==='web');return s.mem>0&&s.pid>0;});
 assert.match(await manager.logs('web'),/Listening on/);
 await manager.action('start','logs');await waitFor(async()=>!(await manager.snapshot()).services.find(s=>s.name==='logs').is_running);
 const lines=(await manager.logs('logs')).trim().split('\n');assert.ok(lines.length<=200);assert.match(lines.at(-1),/line-999/);
 await assert.rejects(manager.logs('not-registered'),/registered/);
});
