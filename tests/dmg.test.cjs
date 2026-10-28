const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {exec}=require('./helpers.cjs');
test('release DMG installs a self-contained App after the image is unmounted',async t=>{
  const dmg=process.env.WICK_TEST_DMG;
  if(!dmg){t.skip('Set WICK_TEST_DMG to test a built release image.');return;}
  const checksum=(await fs.readFile(dmg+'.sha256','utf8')).trim().split(/\s+/);
  assert.equal(checksum[1],path.basename(dmg));
  assert.equal(createHash('sha256').update(await fs.readFile(dmg)).digest('hex'),checksum[0]);
  await exec('/usr/bin/hdiutil',['verify',dmg],{timeout:120000});
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'wick-dmg install-'));
  const mount=path.join(home,'mounted');
  await fs.mkdir(mount);
  let attached=false;
  t.after(async()=>{if(attached)await exec('/usr/bin/hdiutil',['detach',mount]);});
  await exec('/usr/bin/hdiutil',['attach',dmg,'-readonly','-nobrowse','-noautoopen','-mountpoint',mount],{timeout:120000});
  attached=true;
  assert.equal(await fs.readlink(path.join(mount,'Applications')),'/Applications');
  const app=path.join(home,'Applications/Wick.app');
  await exec('/usr/bin/ditto',[path.join(mount,'Wick.app'),app]);
  await exec('/usr/bin/hdiutil',['detach',mount]);attached=false;
  const plist=path.join(app,'Contents/Info.plist');
  const version=(await exec('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw',plist])).stdout.trim();
  assert.equal(version,require('../package.json').version);
  for(const excluded of ['dist','.scratch','.git','.cache']){
    await assert.rejects(fs.access(path.join(app,'Contents/Resources/app',excluded)),{code:'ENOENT'});
  }
  const env={...process.env,WICK_TEST_BUNDLE:app};
  // The child is a separate test run, not a worker of this node:test runner.
  delete env.NODE_TEST_CONTEXT;
  const result=await exec(process.execPath,['--test','--test-reporter=tap',path.join(__dirname,'packaged-agent.test.cjs')],{
    env,timeout:120000
  });
  assert.match(result.stdout,/# pass 1/);
  assert.match(result.stdout,/# skipped 0/);
  const evidence=path.join(__dirname,'../.scratch/release-v0.1.1/evidence');
  await fs.mkdir(evidence,{recursive:true});
  await fs.writeFile(path.join(evidence,'dmg-install.json'),JSON.stringify({
    date:new Date().toISOString(),dmg,sha256:checksum[0],installedApp:app,version,
    imageUnmountedBeforeLaunch:true,agentWorkflowPassed:true
  },null,2));
});
