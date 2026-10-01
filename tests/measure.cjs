const root=require('node:path').resolve(__dirname,'..');
const { _electron:electron }=require(root+'/node_modules/@playwright/test');
const {fixture,web,reachable,cleanup,exec}=require(root+'/tests/helpers.cjs');
const fs=require('node:fs/promises');const path=require('node:path');const YAML=require(root+'/node_modules/yaml');
(async()=>{
 const {home,manager}=await fixture();let app;
 const sampler=home+'/footprint';
 await exec('/usr/bin/cc',[path.join(__dirname,'footprint.c'),'-o',sampler]);
 const evidence=path.join(root,'.scratch/localdeck-mvp/evidence');await fs.mkdir(evidence,{recursive:true});
 const report={date:new Date().toISOString(),home,metric:'RSS in KiB and proc_pid_rusage RUSAGE_INFO_V2 phys_footprint in bytes; Electron sums cover its main process and descendants, not unique physical RAM',samples:[]};
 try{
   await fs.writeFile(manager.config,YAML.stringify({version:'0.5',processes:{notes:{...web(home,'notes'),disabled:false,'x-localdeck':{title:'Notes · test service',url:'http://localhost:5231'}},rss:{...web(home,'rss'),disabled:true,'x-localdeck':{title:'RSS · test service'}},api:{...web(home,'api'),disabled:true,'x-localdeck':{title:'Local API · test service'}}}}));
   const executable=path.join(root,'dist/LocalDeck-darwin-arm64/LocalDeck.app/Contents/MacOS/LocalDeck');
   app=await electron.launch({executablePath:executable,args:[],env:{...process.env,LOCALDECK_HOME:home}});
   const page=await app.firstWindow();await page.emulateMedia({colorScheme:null});await reachable(home,'notes');
   const data=YAML.parse(await fs.readFile(manager.config,'utf8'));data.processes.notes['x-localdeck'].url='http://127.0.0.1:'+await fs.readFile(home+'/notes.port','utf8');await fs.writeFile(manager.config,YAML.stringify(data));await manager.apply();await page.waitForTimeout(2200);
   await page.locator('[data-service="notes"]').click();
   await page.getByRole('button',{name:'Show logs',exact:true}).click();
   await page.waitForTimeout(1500);
   for(const theme of ['light','dark']){await app.evaluate(({nativeTheme},theme)=>{nativeTheme.themeSource=theme;},theme);await page.waitForTimeout(200);await page.screenshot({path:path.join(evidence,`console-${theme}.png`)});}
   const appPid=app.process().pid;
   for(let i=0;i<3;i++){
     await page.waitForTimeout(2500);
     const state=(await manager.snapshot()).services.find(s=>s.name==='notes');
     const managerPid=Number((await exec('/bin/ps',['-o','ppid=','-p',String(state.pid)])).stdout.trim());
     const stdout=(await exec('/bin/ps',['-axo','pid,ppid,rss,%cpu,command'])).stdout;
     const all=stdout.split('\n').map(line=>{const m=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);return m?{pid:+m[1],ppid:+m[2],rssKiB:+m[3],cpu:+m[4],command:m[5]}:null;}).filter(Boolean);
     const ids=new Set([appPid]);let changed=true;while(changed){changed=false;for(const p of all)if(ids.has(p.ppid)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}
     const tree=all.filter(p=>ids.has(p.pid));
     const footprints=(await exec(sampler,[...tree.map(p=>String(p.pid)),String(managerPid),String(state.pid)])).stdout.trim().split('\n').map(line=>line.split(' ').map(Number));
     const footprint=Object.fromEntries(footprints);
     report.samples.push({electronTreeRssKiB:tree.reduce((sum,p)=>sum+p.rssKiB,0),electronTreeFootprintBytes:tree.reduce((sum,p)=>sum+footprint[p.pid],0),managerFootprintBytes:footprint[managerPid],serviceFootprintBytes:footprint[state.pid],electron:tree,manager:all.find(p=>p.pid===managerPid),service:all.find(p=>p.pid===state.pid)});
   }
   const electronPids=report.samples.at(-1).electron.map(p=>p.pid);
   await app.close();app=null;await reachable(home,'notes');await new Promise(r=>setTimeout(r,1500));
   const remaining=electronPids.filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});
   report.afterQuit={serviceReachable:true,electronTreePidsRemaining:remaining};
   if(remaining.length)throw new Error('Electron processes remained after quit: '+remaining.join(','));
   await fs.writeFile(path.join(evidence,'resources.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify(report.samples.map(s=>({electronMiB:s.electronTreeRssKiB/1024,managerMiB:s.manager.rssKiB/1024,serviceMiB:s.service.rssKiB/1024,electronFootprintMiB:s.electronTreeFootprintBytes/1048576,managerFootprintMiB:s.managerFootprintBytes/1048576})),null,2));
 }finally{if(app)await app.close();await cleanup(manager);}
})().catch(e=>{console.error(e);process.exitCode=1;});
