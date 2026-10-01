const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const YAML=require('yaml');
const {fixture,web,cleanup,waitFor}=require('./helpers.cjs');
test('missing executable and occupied port fail with useful logs and finite retries',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const occupied=http.createServer((_req,res)=>res.end('Other server'));
 await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>occupied.close(resolve)));
 const availability={restart:'on_failure',max_restarts:1,backoff_seconds:1};
 const port=occupied.address().port;
 await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{missing:{command:'exec /no-such-localdeck-program',disabled:true,availability},conflict:{...web(home),command:web(home).command+` ${port}`,availability}}}));
 await manager.ensure();
 for(const name of ['missing','conflict']){
   await manager.action('start',name);
   const state=await waitFor(async()=>{const s=(await manager.snapshot()).services.find(s=>s.name===name);return s.status==='Completed'&&!s.is_running&&s.restarts===1?s:false;});
   assert.notEqual(state.exit_code,0);
 }
 assert.match(await manager.logs('missing'),/No such file|not found/);
 assert.match(await manager.logs('conflict'),/EADDRINUSE/);
 assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(),'Other server');
});

test('large output is rotated on disk and bounded in recent logs',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const command=`exec "${process.execPath}" -e 'for(let i=0;i<50000;i++)console.log("line-"+i+" "+"x".repeat(100))'`;
 await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{noise:{command,disabled:true}}}));
 await manager.ensure();await manager.action('start','noise');
 await waitFor(async()=>{const s=(await manager.snapshot()).services[0];return s.status==='Completed';});
 const logs=await manager.logs('noise');assert.ok(logs.length<=128*1024);assert.ok(logs.split('\n').length<=200);assert.match(logs,/line-49999/);
 const files=(await fs.readdir(home+'/logs')).filter(name=>name.startsWith('noise'));
 assert.ok(files.length<=3);assert.ok(files.length>1);
 for(const file of files)assert.ok((await fs.stat(home+'/logs/'+file)).size<=1024*1024);
});
