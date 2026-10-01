const {test}=require('node:test');
const fs=require('node:fs/promises');
const path=require('node:path');
const YAML=require('yaml');
const {installLogin}=require('../src/login.cjs');
const {fixture,web,reachable,cleanup,exec}=require('./helpers.cjs');
const bundle=path.resolve(__dirname,'../dist/LocalDeck-darwin-arm64/LocalDeck.app/Contents');
test('packaged Electron can prepare launchd configuration without a separate Node installation',async t=>{
 try{await fs.access(bundle+'/MacOS/LocalDeck');}catch{t.skip('Run npm run build to verify the packaged bootstrap.');return;}
 const {home,manager}=await fixture();const label=`dev.localdeck.package-test.${process.pid}`;const domain=`gui/${process.getuid()}`;
 t.after(async()=>{await exec('/bin/launchctl',['bootout',domain+'/'+label]).catch(()=>{});await cleanup(manager);});
 await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{web:{...web(home),disabled:false}}}));
 await installLogin(manager,{label,agentPath:home+'/agent.plist',executable:bundle+'/MacOS/LocalDeck',script:bundle+'/Resources/app/scripts/config.cjs'});
 await reachable(home);
});
