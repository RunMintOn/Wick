const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const YAML = require('yaml');
const http = require('node:http');
const {createHash,randomUUID}=require('node:crypto');
const {serviceModel,processStatus,aggregate,validateDisplay}=require('./service-model.cjs');
const tokenOf=text=>createHash('sha256').update(text).digest('hex');
const exec = promisify(execFile);
const defaultHome = () => process.env.WICK_HOME || path.join(os.homedir(), 'Library', 'Application Support', 'Wick');
class ServiceManager {
  constructor(home = defaultHome()) {
    this.home = home;
    this.config = path.join(home, 'services.yaml');
    this.socket = path.join(home, 'control.sock');
    this.runtime = path.join(home,'runtime.yaml');
    this.binary = process.env.WICK_PC || '/opt/homebrew/bin/process-compose';
    this.starting = null;
  }
  async cli(args) {
    try {
      const {stdout} = await exec(this.binary, ['-U', '-u', this.socket, '-L', '/dev/null', ...args], {timeout:15000, maxBuffer:2*1024*1024, cwd:this.home,env:{...process.env,PROC_COMP_CONFIG:this.home}});
      return stdout;
    } catch (error) {
      throw new Error(`Process Compose ${args.join(' ')} failed (${error.code ?? error.signal ?? 'unknown'}):\n${error.stderr?.trim() || error.message}`);
    }
  }
  async readConfig() {
    const text = await fs.readFile(this.config, 'utf8');
    const doc = YAML.parseDocument(text);
    if(doc.errors.length) throw new Error(doc.errors.map(e=>e.message).join('\n'));
    const data = doc.toJS();
    if(!data || !data.processes || typeof data.processes!=='object' || Array.isArray(data.processes)) throw new Error('Configuration must contain a processes mapping.');
    return {text, doc, data};
  }
  async init() {
    await fs.mkdir(this.home,{recursive:true,mode:0o700});
    try {await fs.writeFile(this.config,'version: "0.5"\nlog_level: info\nlog_length: 500\nprocesses: {}\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  }
  async connected() {try {await this.request('/processes');return true;}catch{return false;}}
  async ensure() {
    if(this.starting) return this.starting;
    this.starting = this.start().finally(()=>{this.starting=null;});
    return this.starting;
  }
  async withLock(operation) {
    await this.init();
    const lock=path.join(this.home,'operation.lock');
    let handle;
    for(let i=0;i<100;i++){
      try{handle=await fs.open(lock,'wx',0o600);break;}catch(e){if(e.code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,100));}
    }
    if(!handle)throw new Error('Another Wick operation is busy. If no operation is running, remove the stale operation.lock and retry.');
    try{await handle.writeFile(String(process.pid));return await operation();}finally{await handle.close();await fs.unlink(lock);}
  }
  async start() {return this.withLock(()=>this.startUnlocked());}
  async startUnlocked() {
    if(await this.connected()) return;
    const {staged}=await this.prepare(false);
    await fs.rename(staged,this.runtime);
    await this.cli(['up','-f',this.runtime,'-D','--keep-project','--disable-dotenv']);
    for(let i=0;i<30;i++) {if(await this.connected())return;await new Promise(r=>setTimeout(r,100));}
    throw new Error('Background manager did not start. Check startup.log and service logs.');
  }
  async prepare(preserve = true) {
    const {data}=await this.readConfig();
    let previous={processes:{}};
    if(preserve){try{previous=YAML.parse(await fs.readFile(this.runtime,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
    const {services,owners}=serviceModel(data);
    const processes={};
    for(const [name,source] of Object.entries(data.processes)) {
      if(source.disabled!==undefined&&typeof source.disabled!=='boolean')throw new Error(`${name}: disabled must be true or false.`);
      if(source.is_disabled!==undefined)throw new Error(`${name}: use disabled, not is_disabled, for login autostart.`);
      if(source.working_dir&&!path.isAbsolute(source.working_dir))throw new Error(`${name}: working_dir must be an absolute path.`);
      if(source.log_location&&!path.isAbsolute(source.log_location))throw new Error(`${name}: log_location must be an absolute path.`);
      if(source.env_file&&!path.isAbsolute(source.env_file))throw new Error(`${name}: env_file must be an absolute path.`);
      if(source.is_foreground||source.is_daemon||source.is_interactive||source.is_tty||source.is_elevated||source.schedule||(source.replicas!==undefined&&source.replicas!==1))throw new Error(`${name}: Wick supports one non-interactive foreground service per registration.`);
      const meta=source['x-wick'];
      if(meta){
        validateDisplay(meta,name);
        if(meta.ready_timeout_seconds!==undefined&&(!Number.isInteger(meta.ready_timeout_seconds)||meta.ready_timeout_seconds<1||meta.ready_timeout_seconds>300))throw new Error(`${name}: ready_timeout_seconds must be an integer from 1 to 300.`);
      }
      const config={...source};delete config['x-wick'];
      // Startup policy must not restart a running service when configuration is applied.
      const service=services.find(s=>s.name===owners.get(name));
      config.disabled=previous.processes?.[name]?.disabled ?? (service.grouped?service.disabled:source.disabled??false);
      if(previous.processes?.[name]?.['x-wick-recovery'])config['x-wick-recovery']=previous.processes[name]['x-wick-recovery'];
      config.availability={restart:'on_failure',backoff_seconds:2,max_restarts:3,...config.availability};
      if(config.availability.max_restarts<1||!Number.isInteger(config.availability.max_restarts)||!Number.isInteger(config.availability.backoff_seconds)||config.availability.backoff_seconds<1||!['on_failure','no'].includes(config.availability.restart)||config.availability.exit_on_end||config.availability.exit_on_skipped)throw new Error(`${name}: use a finite on_failure policy (or no), without project shutdown.`);
      config.log_location ||= path.join(this.home,'logs',`${name}.log`);
      config.log_configuration ||= {flush_each_line:true,rotation:{max_size_mb:1,max_backups:2,max_age_days:7}};
      const rotation=config.log_configuration.rotation;
      if(!rotation||![rotation.max_size_mb,rotation.max_backups].every(value=>Number.isInteger(value)&&value>0))throw new Error(`${name}: log rotation requires finite max_size_mb and max_backups.`);
      processes[name]=config;
    }
    // PC's file logger shares the global log level; warn suppresses service stdout.
    const runtime={...data,log_level:'info',log_length:500,processes};
    if(runtime.log_location){
      if(!path.isAbsolute(runtime.log_location))throw new Error('Global log_location must be an absolute path.');
      runtime.log_configuration ||= {rotation:{max_size_mb:1,max_backups:2,max_age_days:7}};
      const rotation=runtime.log_configuration.rotation;
      if(!rotation||![rotation.max_size_mb,rotation.max_backups].every(value=>Number.isInteger(value)&&value>0))throw new Error('Global log rotation must have finite positive size and backup limits.');
    }
    const staged=path.join(this.home,'runtime.pending.yaml');
    await fs.mkdir(path.join(this.home,'logs'),{recursive:true,mode:0o700});
    await fs.writeFile(staged,YAML.stringify(runtime),{mode:0o600});
    await this.cli(['up','-f',staged,'--dry-run','--disable-dotenv']);
    return {staged,runtime};
  }
  async apply() {return this.withLock(()=>this.applyUnlocked());}
  async applyUnlocked() {
    const {staged}=await this.prepare(true);
    let old;
    try{old=await fs.readFile(this.runtime,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.rename(staged,this.runtime);
    try {
      if(await this.connected()){
        // Server-side reload preserves loader defaults; CLI project update retypes
        // them in this version and restarts otherwise unchanged services.
        const result=await this.request('/project/configuration','POST');
        if(Object.values(result).includes('error'))throw new Error('Some services could not be updated. Check the affected service logs.');
      }
    } catch(e){if(old!==undefined)await fs.writeFile(this.runtime,old,{mode:0o600});throw e;}
  }
  async snapshot() {
    let states;
    try{
      states=(await this.request('/processes')).data;
      if(!Array.isArray(states))throw new Error('Invalid background response.');
    }catch(e){return {home:this.home,background:'unavailable',services:[],error:`Background unavailable.\n${e.message}`};}
    try{
      const {data,text}=await this.readConfig();
      const processes=Object.entries(data.processes).map(([name,config])=>{
        const process={
          name,title:config['x-wick']?.title||name,url:config['x-wick']?.url||'',
          autostart:config.disabled!==true,retryLimit:config.availability?.max_restarts??3,
          dependencies:Object.keys(config.depends_on??{}),hasProbe:!!config.readiness_probe,
          status:'Not applied',...states.find(s=>s.name===name)
        };
        process.displayStatus=processStatus(process);
        return process;
      });
      return {home:this.home,background:'connected',token:tokenOf(text),services:serviceModel(data).services.map(service=>{
        if(!service.grouped)return processes.find(p=>p.name===service.name);
        const components=service.processes.map(name=>processes.find(p=>p.name===name));
        for(const component of components){
          component.blockedBy=component.is_running?[]:component.dependencies.filter(name=>processStatus(processes.find(p=>p.name===name))!=='Running');
        }
        const status=aggregate(components);
        return {name:service.name,title:service.title||service.name,url:service.url||'',autostart:!service.disabled,
          components,status,is_running:components.some(p=>p.is_running)};
      })};
    }catch(e){return {home:this.home,background:'connected',services:[],error:`Configuration unavailable.\n${e.message}`};}
  }
  async action(action,name,options={}) {return this.withLock(()=>this.actionUnlocked(action,name,options));}
  async actionUnlocked(action,name,options={}) {
    if(!['start','stop','restart'].includes(action))throw new Error('Unsupported action.');
    const {data}=await this.readConfig();
    const service=serviceModel(data).services.find(s=>s.name===name);
    if(!service)throw new Error('Service is not registered.');
    if(options.component){
      if(!service.grouped||!service.processes.includes(options.component))throw new Error('Process does not belong to this service.');
      return this.componentAction(action,service,options,data);
    }
    if(service.grouped)return this.groupAction(action,service,data);
    return this.processAction(action,name,data);
  }
  async componentAction(action,service,options,data) {
    const name=options.component;
    const closure=new Set();
    const collect=target=>{
      if(closure.has(target))return;
      closure.add(target);
      Object.keys(data.processes[target].depends_on??{}).forEach(collect);
    };
    if(action==='start'){
      collect(name);
      return this.groupAction('start',{...service,order:service.order.filter(member=>closure.has(member))},data);
    }
    const states=(await this.request('/processes')).data;
    const affected=service.processes.filter(member=>{
      if(member===name)return false;
      closure.clear();collect(member);
      const state=states.find(state=>state.name===member);
      return closure.has(name)&&(state?.is_running||['Restarting','Launching','Pending'].includes(state?.status));
    });
    if(affected.length&&options.confirmImpact!==true){
      const error=new Error(`${action} ${name}: running dependents (${affected.join(', ')}) may be interrupted. They will not be stopped or restarted. Confirm the impact before proceeding.`);
      throw Object.assign(error,{requiresConfirmation:true,affected});
    }
    if(action==='restart'){
      for(const dependency of Object.keys(data.processes[name].depends_on??{})){
        const state=states.find(state=>state.name===dependency);
        if(!state?.is_running||state.is_ready!=='Ready')throw new Error(`${name}: dependency ${dependency} is not ready. Use Start to satisfy dependencies; Restart changes only its target.`);
      }
      await this.processAction('stop',name,data);
      await this.processAction('start',name,data);
      await this.ready(name,data.processes[name]);
    }else await this.processAction('stop',name,data);
  }
  async waitProcess(name,predicate,timeout=15000) {
    const until=Date.now()+timeout;
    do{
      const state=await this.request(`/process/${encodeURIComponent(name)}`);
      if(predicate(state))return state;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<until);
    throw new Error(`${name}: timed out waiting for the process. Check its status and logs.`);
  }
  async ready(name,config) {
    return this.waitProcess(name,state=>{
      if(['Error','Completed'].includes(state.status))throw new Error(`${name}: exited before becoming ready. Check logs.`);
      return state.is_running&&state.status!=='Restarting'&&(!config.readiness_probe||state.is_ready==='Ready');
    },(config['x-wick']?.ready_timeout_seconds??30)*1000);
  }
  async groupAction(action,service,data) {
    const errors=[];
    if(action==='stop'||action==='restart'){
      for(const name of [...service.order].reverse()){
        try{await this.processAction('stop',name,data);}catch(e){errors.push(`${name}: ${e.message}`);}
      }
      // A failed stop must not be followed by a new instance.
      if(action==='stop'||errors.length){
        if(errors.length)throw new Error(errors.join('\n'));
        return;
      }
    }
    const failed=new Set();
    for(const name of service.order){
      const dependencies=Object.keys(data.processes[name].depends_on??{});
      if(dependencies.some(dependency=>failed.has(dependency))){
        failed.add(name);errors.push(`${name}: not started because a dependency failed.`);continue;
      }
      try{
        await this.processAction('start',name,data);
        await this.ready(name,data.processes[name]);
      }catch(e){failed.add(name);errors.push(`${name}: ${e.message}`);}
    }
    if(errors.length)throw new Error(errors.join('\n'));
  }
  async processAction(action,name,data) {
    const before=await this.request(`/process/${encodeURIComponent(name)}`);
    const active=before.is_running||['Restarting','Launching','Pending','Terminating'].includes(before.status);
    if(action==='start'&&active)return;
    if(action==='stop'&&!active)return;
    if(action==='start'||action==='restart'){
      const limit=data.processes[name].availability?.max_restarts??3;
      if(before.restarts>=limit){
        // v1.122 retains the retry counter on ordinary start/restart. A derived
        // revision makes server-side reload re-register only this service. Using
        // its loader avoids JSON number retyping that would affect later reloads.
        const runtime=YAML.parseDocument(await fs.readFile(this.runtime,'utf8'));
        runtime.setIn(['processes',name,'x-wick-recovery'],randomUUID());
        const pending=this.runtime+'.recovery';
        await fs.writeFile(pending,String(runtime),{mode:0o600});await fs.rename(pending,this.runtime);
        const result=await this.request('/project/configuration','POST');
        if(Object.values(result).includes('error'))throw new Error('Service recovery failed. Check logs.');
        if(!(await this.request(`/process/${encodeURIComponent(name)}`)).is_running)await this.cli(['process','start',name]);
        return this.waitProcess(name,state=>state.is_running);
      }
    }
    await this.cli(['process',action,name]);
    await this.waitProcess(name,state=>{
      if(action==='stop')return !state.is_running&&!['Restarting','Launching','Pending','Terminating'].includes(state.status);
      if(state.is_running||['Restarting','Error','Completed'].includes(state.status))return true;
      return false;
    });
  }
  async setAutostart(name,value,token) {return this.withLock(()=>this.setAutostartUnlocked(name,value,token));}
  async setAutostartUnlocked(name,value,token) {
    if(typeof value!=='boolean')throw new Error('Autostart must be true or false.');
    const {text,doc,data}=await this.readConfig();
    if(tokenOf(text)!==token)throw new Error('Configuration changed. Refresh and try again.');
    const service=serviceModel(data).services.find(s=>s.name===name);
    if(!service)throw new Error('Service is not registered.');
    doc.setIn(service.grouped?['x-wick','services',name,'disabled']:['processes',name,'disabled'],!value);
    const pending=this.config+'.pending';
    await fs.writeFile(pending,String(doc),{mode:0o600});
    if(await fs.readFile(this.config,'utf8')!==text)throw new Error('Configuration changed. Refresh and try again.');
    await fs.rename(pending,this.config);
  }
  async request(route,method='GET') {
    return new Promise((resolve,reject)=>{
      const req=http.request({socketPath:this.socket,path:route,method},res=>{
        let text='';
        res.setEncoding('utf8');
        res.on('data',chunk=>{text+=chunk;if(text.length>2*1024*1024)req.destroy(new Error('Response is too large.'));});
        res.on('end',()=>{try{if(res.statusCode!==200&&res.statusCode!==207)throw new Error(`Background request failed (${res.statusCode}): ${text}`);resolve(JSON.parse(text));}catch(e){reject(e);}});
        res.on('error',reject);
      });
      req.setTimeout(5000,()=>req.destroy(new Error('Background request timed out.')));
      req.on('error',reject);
      req.end();
    });
  }
  async logs(name) {
    const {data}=await this.readConfig();
    if(!Object.hasOwn(data.processes,name))throw new Error('Service is not registered.');
    const result=await this.request(`/process/logs/${encodeURIComponent(name)}/0/200`);
    return result.logs.join('\n').slice(-128*1024);
  }
  async serviceUrl(name) {
    const {data}=await this.readConfig();
    const value=serviceModel(data).services.find(s=>s.name===name)?.url;
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol))throw new Error('Service address must use HTTP or HTTPS.');
    return url.href;
  }
  async down() {return this.cli(['down']);}
}
module.exports={ServiceManager,defaultHome};
