const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {fixture,web,cleanup,exec}=require('./helpers.cjs');
const script=path.resolve(__dirname,'../scripts/service.cjs');
test('Agent CLI returns structured state without config-home diagnostics and preserves real failures',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 await require('node:fs/promises').writeFile(manager.config,require('yaml').stringify({processes:{web:web(home)}}));
 await manager.ensure();
 const options={env:{...process.env,WICK_HOME:home}};
 const started=await exec(process.execPath,[script,'start','web'],options);
 assert.equal(started.stderr,'');
 assert.equal(JSON.parse(started.stdout).services[0].is_running,true);
 const stopped=await exec(process.execPath,[script,'stop','web'],options);
 assert.equal(JSON.parse(stopped.stdout).services[0].is_running,false);
 await assert.rejects(exec(process.execPath,[script,'start','missing'],options),error=>{
  assert.equal(error.code,1);
  assert.match(error.stderr,/not registered/);
  assert.doesNotMatch(error.stderr,/Path not found/);
  return true;
 });
});

test('successful Process Compose stderr is not treated as operation failure',async t=>{
 const {home,manager}=await fixture();t.after(()=>cleanup(manager));
 const binary=manager.binary,wrapper=path.join(home,'diagnostic.cjs');
 await require('node:fs/promises').writeFile(wrapper,`#!${process.execPath}\nconsole.error("diagnostic only");const result=require("node:child_process").spawnSync(${JSON.stringify(binary)},process.argv.slice(2),{stdio:"inherit"});process.exit(result.status??1);\n`,{mode:0o700});
 manager.binary=wrapper;
 assert.match(await manager.cli(['version']),/Process Compose/);
});
