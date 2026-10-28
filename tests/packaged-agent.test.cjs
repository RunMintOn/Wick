const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const YAML=require('yaml');
const { _electron:electron }=require('@playwright/test');
const {exec,waitFor}=require('./helpers.cjs');
const builtBundle=path.resolve(process.env.WICK_TEST_BUNDLE||path.join(__dirname,'../dist/Wick-darwin-arm64/Wick.app'));
test('a fresh Agent manages services and optionally links the Skill using only the installed App',async t=>{
  try{await fs.access(builtBundle);}catch{t.skip('Build Wick first.');return;}
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'wick-agent install-'));
  const bundle=path.join(home,'Applications/Wick.app');
  await exec('/usr/bin/ditto',[builtBundle,bundle]);
  const data=path.join(home,'data');
  const executable=path.join(bundle,'Contents/MacOS/Wick');
  const cli=path.join(bundle,'Contents/Resources/app/bin/wick');
  const env={...process.env,HOME:home,WICK_HOME:data,WICK_HEADLESS:'1',PATH:'/usr/bin:/bin:/usr/sbin:/sbin'};
  delete env.WICK_PC;
  const run=(...args)=>exec('/bin/sh',[cli,...args],{env});
  let app;
  const pc=path.join(bundle,'Contents/Resources/bin/process-compose');
  t.after(async()=>{
    if(app)await app.close();
    await exec(pc,['-U','-u',path.join(data,'control.sock'),'down'],{env}).catch(()=>{});
  });
  assert.match((await run('--help')).stdout,/validate/);
  for(const file of ['process-compose/LICENSE','electron/LICENSE','electron/LICENSES.chromium.html']){
    await fs.access(path.join(bundle,'Contents/Resources/licenses',file));
  }
  await assert.rejects(fs.access(path.join(bundle,'Contents/Resources/app/dist')),{code:'ENOENT'});
  const skillText=await fs.readFile(path.join(bundle,'Contents/Resources/app/skills/wick/SKILL.md'),'utf8');
  const setup=skillText.match(/```bash\n([\s\S]*?)```/)[1];
  assert.match((await exec('/bin/sh',['-c',setup+'\nwick --help'],{
    env:{...env,SKILL_DIR:path.join(bundle,'Contents/Resources/app/skills/wick')}
  })).stdout,/validate/);
  app=await electron.launch({executablePath:executable,env});
  await app.firstWindow();
  await waitFor(async()=>JSON.parse((await run('list')).stdout).background==='connected');
  const managerCommand=(await exec('/bin/ps',['-axo','command='])).stdout.split('\n')
    .find(line=>line.includes(pc)&&line.includes(path.join(data,'control.sock')));
  assert.ok(managerCommand,'The background must run the installed App’s bundled Process Compose.');
  await assert.rejects(fs.lstat(path.join(home,'.agents/skills/wick')), {code:'ENOENT'});
  const service=path.join(home,'service.cjs');
  await fs.writeFile(service,`const fs=require('node:fs');const server=require('node:http').createServer((q,r)=>r.end('wick-onboarding-ok'));server.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(path.join(home,'port'))},String(server.address().port)));`);
  await fs.writeFile(path.join(data,'services.yaml'),YAML.stringify({version:'0.5',processes:{example:{
    command:`exec "${executable}" "${service}"`,environment:['ELECTRON_RUN_AS_NODE=1'],disabled:true
  }}}));
  await run('validate');await run('apply');await run('start','example');
  const snapshot=JSON.parse((await run('list')).stdout);
  const pid=snapshot.services[0].pid;
  const port=await fs.readFile(path.join(home,'port'),'utf8');
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(),'wick-onboarding-ok');
  const consolePid=app.process().pid;
  const tree=(await exec('/bin/ps',['-axo','pid=,ppid='])).stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
  const consolePids=new Set([consolePid]);
  for(let size=0;size!==consolePids.size;){
    size=consolePids.size;
    for(const [pid,parent] of tree)if(consolePids.has(parent))consolePids.add(pid);
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await waitFor(()=>[...consolePids].every(pid=>{try{process.kill(pid,0);return false;}catch{return true;}}));
  app=null;
  const afterClose=JSON.parse((await run('list')).stdout);
  assert.equal(afterClose.services[0].pid,pid);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(),'wick-onboarding-ok');
  await run('skill:install');
  const skill=path.join(home,'.agents/skills/wick');
  assert.equal(await fs.realpath(skill),await fs.realpath(path.join(bundle,'Contents/Resources/app/skills/wick')));
  assert.match(await fs.readFile(path.join(skill,'SKILL.md'),'utf8'),/disable-model-invocation: true/);
  await run('skill:install');
  const otherHome=path.join(home,'another-user');
  const otherSkill=path.join(otherHome,'.agents/skills/wick');
  await fs.mkdir(otherSkill,{recursive:true});
  await fs.writeFile(path.join(otherSkill,'SKILL.md'),'User-owned Skill');
  await assert.rejects(exec('/bin/sh',[cli,'skill:install'],{env:{...env,HOME:otherHome}}),/Existing Skill is preserved/);
  assert.equal(await fs.readFile(path.join(otherSkill,'SKILL.md'),'utf8'),'User-owned Skill');
  await run('stop','example');
  assert.equal(JSON.parse((await run('list')).stdout).services[0].is_running,false);
  await run('start','example');await run('restart','example');
  assert.equal(JSON.parse((await run('list')).stdout).services[0].is_running,true);
  const report={date:new Date().toISOString(),bundle,home,path:env.PATH,binary:pc,serviceAccessible:true,pidBeforeClose:pid,
    pidAfterClose:afterClose.services[0].pid,consolePids:[...consolePids],consoleExited:true,
    skillTarget:await fs.realpath(skill),existingSkillPreserved:true,managerCommand,startStopRestart:true};
  const evidence=path.join(__dirname,'../.scratch/bundled-process-compose/evidence');
  await fs.mkdir(evidence,{recursive:true});
  await fs.writeFile(path.join(evidence,'packaged-agent.json'),JSON.stringify(report,null,2));
});
