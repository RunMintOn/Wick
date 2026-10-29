const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {fs,path,exec,output,evidence,waitFor,setup}=require('./helpers.cjs');
const {version}=require('../package.json');

test('DMG installs a self-contained App and CLI without Node/Homebrew in PATH',async t=>{
  const dmg=path.resolve(process.env.WICK_TEST_DMG||path.join(output,`Wick-${version}-darwin-arm64.dmg`));
  const expected=(await fs.readFile(dmg+'.sha256','utf8')).split(/\s/)[0];
  const bytes=await fs.readFile(dmg);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected);
  assert.ok(bytes.length<=50_000_000,`DMG is ${bytes.length} bytes`);
  const mount=await fs.mkdtemp('/tmp/wick-mount-');
  let context;
  await exec('/usr/bin/hdiutil',['attach',dmg,'-readonly','-nobrowse','-noautoopen','-mountpoint',mount]);
  try{
    assert.equal(await fs.readlink(path.join(mount,'Applications')),'/Applications');
    context=await setup(t,'wick-installed',path.join(mount,'Wick.app'));
  }finally{
    await exec('/usr/bin/hdiutil',['detach',mount]);
  }
  const {home,data,app,pc,run,service,launch}=context;
  assert.match((await run('--help')).stdout,/validate/);
  await assert.rejects(run('validate','extra'),/does not accept arguments/);
  await fs.access(path.join(app,'Contents/Resources/licenses/go/github.com/egoist/mygo/LICENSE'));
  await fs.access(path.join(app,'Contents/Resources/licenses/process-compose/LICENSE'));
  await assert.rejects(fs.access(path.join(app,'Contents/Frameworks')),{code:'ENOENT'});
  const script=await fs.readFile(path.join(app,'Contents/Resources/app/skills/wick/SKILL.md'),'utf8');
  const setupScript=script.match(/```bash\n([\s\S]*?)```/)[1];
  const result=await exec('/bin/sh',['-c',setupScript+'\nwick --help'],{
    env:{...context.env,SKILL_DIR:path.join(app,'Contents/Resources/app/skills/wick')}
  });
  assert.match(result.stdout,/validate/);
  const child=await launch('installed-console');
  await waitFor(async()=>JSON.parse((await run('list')).stdout).background==='connected');
  await fs.writeFile(path.join(data,'services.yaml'),`version: "0.5"
processes:
  example:
    command: "exec ${service} ${data} example"
    disabled: true
    x-wick:
      title: Example
`);
  await run('validate');await run('apply');await run('start','example');
  const before=JSON.parse((await run('list')).stdout);
  const pid=before.services[0].pid;
  const address=await waitFor(()=>fs.readFile(path.join(data,'example.address'),'utf8'));
  assert.equal(await (await fetch(address)).text(),'wick-installed-example');
  child.kill('SIGTERM');
  await waitFor(()=>child.exitCode!==null||child.signalCode!==null);
  assert.equal(JSON.parse((await run('list')).stdout).services[0].pid,pid);
  assert.equal(await (await fetch(address)).text(),'wick-installed-example');
  await run('stop','example');await run('start','example');await run('restart','example');
  assert.equal(JSON.parse((await run('list')).stdout).services[0].is_running,true);
  await assert.rejects(fs.lstat(path.join(home,'.agents/skills/wick')),{code:'ENOENT'});
  await run('skill:install');await run('skill:install');
  assert.equal(await fs.realpath(path.join(home,'.agents/skills/wick')),
    await fs.realpath(path.join(app,'Contents/Resources/app/skills/wick')));
  const otherHome=path.join(home,'other');
  const otherSkill=path.join(otherHome,'.agents/skills/wick');
  await fs.mkdir(otherSkill,{recursive:true});
  await fs.writeFile(path.join(otherSkill,'SKILL.md'),'user-owned');
  await assert.rejects(exec('/bin/sh',[context.cli,'skill:install'],{env:{...context.env,HOME:otherHome}}),/existing Skill is preserved/);
  assert.equal(await fs.readFile(path.join(otherSkill,'SKILL.md'),'utf8'),'user-owned');
  const managerCommand=(await exec('/bin/ps',['-axo','command='])).stdout.split('\n')
    .find(line=>line.includes(pc)&&line.includes(path.join(data,'control.sock')));
  assert.ok(managerCommand,'background must use the installed bundled Process Compose');
  await fs.writeFile(path.join(evidence,'installed.json'),JSON.stringify({
    dmg,bytes:bytes.length,installedApp:app,path:context.env.PATH,
    servicePIDBeforeConsoleExit:pid,servicePIDAfterConsoleExit:pid,
    lifecycle:true,skill:true,managerCommand
  },null,2));
});
