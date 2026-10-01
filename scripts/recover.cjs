const {ServiceManager}=require('../src/services.cjs');
const name=process.argv[2];
if(!name){console.error('Pass the registered service identifier.');process.exitCode=1;}
else new ServiceManager().action('start',name).then(()=>console.log('Service started with an available retry budget.')).catch(error=>{console.error(error.message);process.exitCode=1;});
