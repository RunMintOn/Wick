const {ServiceManager}=require('../src/services.cjs');
(async()=>{
 const manager=new ServiceManager();await manager.init();
 if(process.argv.includes('--check')){await manager.withLock(()=>manager.prepare(true));console.log('Configuration is valid.');}
 else if(process.argv.includes('--boot')){const exists=await manager.withLock(async()=>{if(await manager.connected())return true;const {staged}=await manager.prepare(false);await require('node:fs/promises').rename(staged,manager.runtime);return false;});if(exists)process.exitCode=10;}
 else{await manager.apply();console.log('Configuration applied. Unchanged services were preserved.');}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
