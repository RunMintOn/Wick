const identifier=/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
function validateDisplay(meta,name){
 if(!meta||typeof meta!=='object'||Array.isArray(meta)||(meta.title!==undefined&&typeof meta.title!=='string'))throw new Error(`${name}: invalid display metadata.`);
 if(meta.url){const url=new URL(meta.url);if(!['http:','https:'].includes(url.protocol))throw new Error(`${name}: address must use HTTP or HTTPS.`);}
}
function serviceModel(data){
 for(const [name,process] of Object.entries(data.processes)){
  if(!identifier.test(name)||!process||typeof process!=='object'||Array.isArray(process))throw new Error(`Invalid process definition: ${name}`);
 }
 const definitions=data['x-wick']?.services??{};
 if(typeof definitions!=='object'||Array.isArray(definitions))throw new Error('x-wick.services must be a mapping.');
 const owners=new Map();
 const services=[];
 for(const [name,definition] of Object.entries(definitions)){
  if(!identifier.test(name)||Object.hasOwn(data.processes,name))throw new Error(`Invalid or conflicting service identifier: ${name}`);
  validateDisplay(definition,name);
  if(typeof definition.disabled!=='boolean')throw new Error(`${name}: disabled must be explicit.`);
  if(!Array.isArray(definition.processes)||!definition.processes.length)throw new Error(`${name}: processes must be a nonempty list.`);
  for(const member of definition.processes){
   if(typeof member!=='string'||!Object.hasOwn(data.processes,member))throw new Error(`${name}: unknown process ${member}`);
   if(owners.has(member))throw new Error(`${member}: process belongs to more than one service.`);
   if(data.processes[member].disabled!==undefined)throw new Error(`${member}: set disabled on its service, not on a component.`);
   owners.set(member,name);
  }
  services.push({...definition,name,grouped:true});
 }
 for(const [name,process] of Object.entries(data.processes)){
  if(!owners.has(name)){
   owners.set(name,name);
   services.push({...process['x-wick'],name,disabled:process.disabled!==false,processes:[name],grouped:false});
  }
 }
 for(const service of services){
  const visiting=new Set(),done=new Set(),order=[];
  function visit(name){
   if(visiting.has(name))throw new Error(`${name}: dependency cycle.`);
   if(done.has(name))return;
   visiting.add(name);
   const dependencies=data.processes[name].depends_on??{};
   if(typeof dependencies!=='object'||Array.isArray(dependencies))throw new Error(`${name}: depends_on must be a mapping.`);
   for(const [dependency,rule] of Object.entries(dependencies)){
    if(!Object.hasOwn(data.processes,dependency))throw new Error(`${name}: unknown dependency ${dependency}`);
    if(service.grouped){
     if(owners.get(dependency)!==service.name)throw new Error(`${name}: dependencies must belong to the same service.`);
     if(rule?.condition!=='process_healthy'||!data.processes[dependency].readiness_probe)throw new Error(`${name}: dependencies require process_healthy and a readiness_probe on ${dependency}.`);
     visit(dependency);
    }
   }
   visiting.delete(name);done.add(name);order.push(name);
  }
  service.processes.forEach(visit);
  service.order=order;
 }
 return {services,owners};
}
function processStatus(state){
 if(state.status==='Not applied')return 'Not applied';
 if(state.status==='Restarting')return 'Restarting';
 if(state.is_running){
  if(state.is_ready==='Not Ready')return 'Unhealthy';
  if(state.hasProbe&&state.is_ready!=='Ready')return 'Starting';
  return 'Running';
 }
 if(['Launching','Pending','Terminating'].includes(state.status))return state.status;
 if(state.status==='Error'||(state.status==='Completed'&&![0,-1,143].includes(state.exit_code)))return 'Failed';
 return 'Stopped';
}
function aggregate(components){
 const statuses=components.map(processStatus);
 if(statuses.every(s=>s==='Running'))return 'Running';
 if(statuses.every(s=>s==='Stopped'))return 'Stopped';
 if(statuses.some(s=>s==='Not applied'))return 'Not applied';
 if(components.some(s=>s.is_running))return 'Partially running';
 if(statuses.some(s=>['Failed','Unhealthy'].includes(s)))return 'Failed';
 return 'Starting';
}
module.exports={serviceModel,processStatus,aggregate,validateDisplay};
