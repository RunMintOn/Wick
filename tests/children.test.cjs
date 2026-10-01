const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const YAML=require('yaml');
const {fixture,web,reachable,cleanup,waitFor}=require('./helpers.cjs');
test('stopping a registered parent terminates its serving child',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const script=path.join(home,'parent.cjs');
 await fs.writeFile(script,`const child=require('child_process').spawn(${JSON.stringify(process.execPath)},[${JSON.stringify(path.join(__dirname,'web.cjs'))},${JSON.stringify(home)},'web'],{stdio:'inherit'});require('fs').writeFileSync(${JSON.stringify(path.join(home,'child.pid'))},String(child.pid));setInterval(()=>{},1000);`);
 await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{web:{...web(home),command:`exec "${process.execPath}" "${script}"`}}}));
 await manager.ensure();await manager.action('start','web');await reachable(home);
 const pid=Number(await fs.readFile(path.join(home,'child.pid'),'utf8'));
 await manager.action('stop','web');await waitFor(()=>{try{process.kill(pid,0);return false;}catch{return true;}});
 assert.throws(()=>process.kill(pid,0));
 await assert.rejects(fetch(`http://127.0.0.1:${await fs.readFile(path.join(home,'web.port'),'utf8')}`,{signal:AbortSignal.timeout(1000)}));
});
