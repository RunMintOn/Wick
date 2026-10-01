const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const YAML = require('yaml');
const http = require('node:http');
const {createHash,randomUUID}=require('node:crypto');
const tokenOf=text=>createHash('sha256').update(text).digest('hex');
const exec = promisify(execFile);
const defaultHome = () => process.env.LOCALDECK_HOME || path.join(os.homedir(), 'Library', 'Application Support', 'LocalDeck');
class ServiceManager {
  constructor(home = defaultHome()) {
    this.home = home;
    this.config = path.join(home, 'services.yaml');
    this.socket = path.join(home, 'control.sock');
    this.runtime = path.join(home,'runtime.yaml');
    this.binary = process.env.LOCALDECK_PC || '/opt/homebrew/bin/process-compose';
    this.starting = null;
  }
  async cli(args) {
    try {
      const {stdout} = await exec(this.binary, ['-U', '-u', this.socket, '-L', '/dev/null', ...args], {timeout:15000, maxBuffer:2*1024*1024, cwd:this.home});
      return stdout;
    } catch (error) {
      throw new Error(error.stderr?.trim() || error.message);
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
    if(!handle)throw new Error('Another LocalDeck operation is busy. If no operation is running, remove the stale operation.lock and retry.');
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
    const processes={};
    for(const [name,source] of Object.entries(data.processes)) {
      if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name))throw new Error(`Invalid service identifier: ${name}`);
      if(!source||typeof source!=='object'||Array.isArray(source))throw new Error(`Invalid service definition: ${name}`);
      if(source.disabled!==undefined&&typeof source.disabled!=='boolean')throw new Error(`${name}: disabled must be true or false.`);
      if(source.is_disabled!==undefined)throw new Error(`${name}: use disabled, not is_disabled, for login autostart.`);
      if(source.working_dir&&!path.isAbsolute(source.working_dir))throw new Error(`${name}: working_dir must be an absolute path.`);
      if(source.log_location&&!path.isAbsolute(source.log_location))throw new Error(`${name}: log_location must be an absolute path.`);
      if(source.env_file&&!path.isAbsolute(source.env_file))throw new Error(`${name}: env_file must be an absolute path.`);
      if(source.is_foreground||source.is_daemon||source.is_interactive||source.is_tty||source.is_elevated||source.schedule||(source.replicas!==undefined&&source.replicas!==1))throw new Error(`${name}: LocalDeck supports one non-interactive foreground service per registration.`);
      const meta=source['x-localdeck'];
      if(meta){
        if(typeof meta!=='object'||Array.isArray(meta)||(meta.title!==undefined&&typeof meta.title!=='string'))throw new Error(`${name}: invalid display metadata.`);
        if(meta.url){const url=new URL(meta.url);if(!['http:','https:'].includes(url.protocol))throw new Error(`${name}: address must use HTTP or HTTPS.`);}
      }
      const config={...source};delete config['x-localdeck'];
      // Startup policy must not restart a running service when configuration is applied.
      config.disabled=previous.processes?.[name]?.disabled ?? source.disabled ?? false;
      if(previous.processes?.[name]?.['x-localdeck-recovery'])config['x-localdeck-recovery']=previous.processes[name]['x-localdeck-recovery'];
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
      return {home:this.home,background:'connected',token:tokenOf(text),services:Object.entries(data.processes).map(([name,config])=>({
        name,title:config['x-localdeck']?.title||name,url:config['x-localdeck']?.url||'',
        autostart:config.disabled!==true,retryLimit:config.availability?.max_restarts??3,status:'Not applied',...states.find(s=>s.name===name)
      }))};
    }catch(e){return {home:this.home,background:'connected',services:[],error:`Configuration unavailable.\n${e.message}`};}
  }
  async action(action,name) {return this.withLock(()=>this.actionUnlocked(action,name));}
  async actionUnlocked(action,name) {
    if(!['start','stop','restart'].includes(action))throw new Error('Unsupported action.');
    const {data}=await this.readConfig();
    if(!Object.hasOwn(data.processes,name))throw new Error('Service is not registered.');
    if(action==='start'||action==='restart'){
      const state=await this.request(`/process/${encodeURIComponent(name)}`);
      const limit=data.processes[name].availability?.max_restarts??3;
      if(state.restarts>=limit){
        // v1.122 retains the retry counter on ordinary start/restart. A derived
        // revision makes server-side reload re-register only this service. Using
        // its loader avoids JSON number retyping that would affect later reloads.
        const runtime=YAML.parseDocument(await fs.readFile(this.runtime,'utf8'));
        runtime.setIn(['processes',name,'x-localdeck-recovery'],randomUUID());
        const pending=this.runtime+'.recovery';
        await fs.writeFile(pending,String(runtime),{mode:0o600});await fs.rename(pending,this.runtime);
        const result=await this.request('/project/configuration','POST');
        if(Object.values(result).includes('error'))throw new Error('Service recovery failed. Check logs.');
        if(!(await this.request(`/process/${encodeURIComponent(name)}`)).is_running)await this.cli(['process','start',name]);
        return;
      }
    }
    await this.cli(['process',action,name]);
  }
  async setAutostart(name,value,token) {return this.withLock(()=>this.setAutostartUnlocked(name,value,token));}
  async setAutostartUnlocked(name,value,token) {
    if(typeof value!=='boolean')throw new Error('Autostart must be true or false.');
    const {text,doc,data}=await this.readConfig();
    if(tokenOf(text)!==token)throw new Error('Configuration changed. Refresh and try again.');
    if(!Object.hasOwn(data.processes,name))throw new Error('Service is not registered.');
    doc.setIn(['processes',name,'disabled'],!value);
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
    const value=data.processes[name]?.['x-localdeck']?.url;
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol))throw new Error('Service address must use HTTP or HTTPS.');
    return url.href;
  }
  async down() {return this.cli(['down']);}
}
module.exports={ServiceManager,defaultHome};
