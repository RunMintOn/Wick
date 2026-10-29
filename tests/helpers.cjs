const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const root=path.resolve(__dirname,'..');
const output=path.resolve(root,process.env.WICK_BUILD_OUT||'build');
const bundle=path.resolve(process.env.WICK_TEST_BUNDLE||path.join(output,'Wick-darwin-arm64/Wick.app'));
const evidence=path.join(root,'.scratch/mygo-migration/evidence');
const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
async function waitFor(fn,timeout=15000){
  const end=Date.now()+timeout;
  let last;
  while(Date.now()<end){
    try{const result=await fn();if(result)return result;}catch(error){last=error;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw last||new Error('Timed out waiting for expected state');
}
async function setup(t,prefix,sourceBundle=bundle){
  await fs.mkdir(evidence,{recursive:true});
  const home=await fs.mkdtemp(`/tmp/${prefix}-`);
  const data=path.join(home,'data');
  const app=path.join(home,'Applications with spaces/Wick.app');
  await exec('/usr/bin/ditto',[sourceBundle,app]);
  await fs.mkdir(data);
  const executable=path.join(app,'Contents/MacOS/Wick');
  const pc=path.join(app,'Contents/Resources/bin/process-compose');
  const cli=path.join(app,'Contents/Resources/app/bin/wick');
  await fs.mkdir(path.join(home,'run'));
  const env={...process.env,HOME:home,WICK_HOME:data,WICK_HEADLESS:'1',PATH:'/usr/bin:/bin:/usr/sbin:/sbin',XDG_RUNTIME_DIR:path.join(home,'run')};
  delete env.WICK_PC;
  const service=path.join(home,'http-service');
  await exec('go',['build','-o',service,'./tests/service'],{cwd:root});
  const run=(...args)=>exec('/bin/sh',[cli,...args],{env});
  const launch=async(name)=>{
    const file=await fs.open(path.join(evidence,name+'.log'),'w');
    const child=spawn(executable,[],{env,stdio:['ignore',file.fd,file.fd]});
    child.once('exit',()=>file.close());
    t.after(()=>{if(child.exitCode===null)child.kill();});
    return child;
  };
  t.after(async()=>{await exec(pc,['-U','-u',path.join(data,'control.sock'),'down'],{env}).catch(()=>{});});
  return {home,data,app,executable,pc,cli,env,service,run,launch};
}
function rpc(socket,method,params={}){
  return new Promise((resolve,reject)=>{
    const client=net.createConnection(socket);
    client.setTimeout(10000,()=>client.destroy(new Error(`Automation ${method} timed out`)));
    client.on('error',reject);
    client.on('end',()=>reject(new Error(`Automation ${method} connection closed`)));
    client.on('connect',()=>client.write(JSON.stringify({id:1,method,params})+'\n'));
    let text='';
    client.on('data',chunk=>{
      text+=chunk;
      if(!text.includes('\n'))return;
      client.end();
      const response=JSON.parse(text.slice(0,text.indexOf('\n')));
      if(response.error)reject(new Error(response.error.message));
      else resolve(response.result);
    });
  });
}
module.exports={fs,path,exec,root,output,bundle,evidence,quote,waitFor,setup,rpc};
