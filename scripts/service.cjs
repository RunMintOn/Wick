const {ServiceManager}=require('../src/services.cjs');
(async()=>{
 const args=process.argv.slice(2);
 const positional=args.filter(arg=>!arg.startsWith('--'));
 const [action='list',name,component]=positional;
 if(args.some(arg=>arg.startsWith('--')&&arg!=='--confirm-impact'))throw new Error('Unknown option.');
 if(positional.length>3||action==='list'&&name)throw new Error('Unexpected arguments.');
 const manager=new ServiceManager();
 if(action!=='list'){
  if(!name)throw new Error('Usage: npm run service -- list | start|stop|restart <service> [process] [--confirm-impact]');
  await manager.action(action,name,{component,confirmImpact:args.includes('--confirm-impact')});
 }
 const snapshot=await manager.snapshot();
 if(snapshot.error)throw new Error(snapshot.error);
 console.log(JSON.stringify(snapshot,null,2));
 if(action==='start'||action==='restart'){
  const service=snapshot.services.find(service=>service.name===name);
  if(service&&(service.status==='Error'||service.status==='Completed'&&service.exit_code!==0))throw new Error(`${name}: process failed. Check its status and logs.`);
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
