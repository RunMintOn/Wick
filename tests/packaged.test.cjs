const {test}=require('node:test');
const fs=require('node:fs/promises');
const path=require('node:path');
const YAML=require('yaml');
const {installLogin}=require('../src/login.cjs');
const {fixture,web,reachable,cleanup,exec}=require('./helpers.cjs');
const bundle=path.resolve(process.env.WICK_TEST_BUNDLE||path.join(__dirname,'../dist/Wick-darwin-arm64/Wick.app'),'Contents');
test('packaged Electron can prepare launchd configuration without a separate Node installation',async t=>{
 try{await fs.access(bundle+'/MacOS/Wick');}catch{t.skip('Run npm run build to verify the packaged bootstrap.');return;}
 const {home,manager}=await fixture();const label=`dev.wick.package-test.${process.pid}`;const domain=`gui/${process.getuid()}`;
 manager.binary=path.join(bundle,'Resources/bin/process-compose');
 t.after(async()=>{await exec('/bin/launchctl',['bootout',domain+'/'+label]).catch(()=>{});await cleanup(manager);});
 await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{web:{...web(home),disabled:false}}}));
 await installLogin(manager,{label,agentPath:home+'/agent.plist',executable:bundle+'/MacOS/Wick',script:bundle+'/Resources/app/scripts/config.cjs'});
 await reachable(home);
});
