const api=window.wick;
let selected='';
let services=[];
let busy=false;
let logsFor='';
let logText='';
let fetching=false;
let configToken='';
let connectionError=false;
let bandKey='';
const $=id=>document.getElementById(id);
// Shell wrappers report SIGTERM as 128 + 15; Process Compose may report -1.
const signalExit=code=>code===-1||code===143;
function status(s){if(s.components)return s.status;if(s.displayStatus)return s.displayStatus;if(s.status==='Not applied')return 'Not applied';if(s.is_running)return 'Running';if(s.status==='Restarting')return 'Restarting';if(s.status==='Error'||(s.status==='Completed'&&s.exit_code!==0&&!signalExit(s.exit_code)))return 'Failed';return 'Stopped';}
function el(tag,text,className=''){const node=document.createElement(tag);node.textContent=text;node.className=className;return node;}
function iconButton(button,kind,label){
  const paths={
    start:'M5 3l12 7-12 7Z',
    stop:'M4 4h12v12H4Z',
    restart:'M17 7a7 7 0 1 0 0 6M17 2v5h-5',
    logs:'M5 3h10v14H5ZM8 7h4M8 10h4M8 13h3',
    close:'m5 5 10 10M15 5 5 15'
  };
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[kind]);
  svg.append(path);button.replaceChildren(svg,el('span',label,'sr-only'));
  button.title=label;button.classList.add('icon-button');
}
function showError(text){$('error').hidden=!text;$('error').textContent=text||'';}
function setBackground(state){
  const labels={connected:'Connected',connecting:'Connecting',unavailable:'Unavailable'};
  $('background-status').dataset.state=state;
  const label=labels[state]||'Unavailable';
  if($('background-label').textContent!==label)$('background-label').textContent=label;
  $('refresh').textContent=state==='unavailable'?'Reconnect':'Refresh';
  $('refresh').title=state==='unavailable'?'Reconnect to the background manager':'Refresh services';
  $('refresh').disabled=state==='connecting';
}
function confirmImpact(message){
  return new Promise(resolve=>{
    const dialog=el('dialog','','confirmation');
    dialog.setAttribute('aria-label','Confirm process impact');
    dialog.append(el('h3','Confirm process impact'),el('p',message));
    const buttons=el('div','','actions');
    const finish=value=>{dialog.close();dialog.remove();resolve(value);};
    const cancel=el('button','Cancel','btn');cancel.onclick=()=>finish(false);
    const confirm=el('button','Proceed','btn');confirm.onclick=()=>finish(true);
    dialog.oncancel=event=>{event.preventDefault();finish(false);};
    buttons.append(cancel,confirm);dialog.append(buttons);document.body.append(dialog);dialog.showModal();cancel.focus();
  });
}
async function act(action,name,options={}){
  busy=true;render();
  try{
    let result=await api.action(action,name,options);
    if(result.requiresConfirmation){
      if(!await confirmImpact(result.error)){showError('');return;}
      result=await api.action(action,name,{...options,confirmImpact:true});
    }
    showError(result.error);
  }catch(e){showError(e.message);}
  finally{busy=false;await refresh();}
}
function actionButtons(s,serviceName,component=undefined){
  const actions=el('div','','actions');
  const active=(s.components||[s]).some(p=>p.is_running||['Restarting','Launching','Pending','Terminating'].includes(p.status));
  for(const action of ['start','stop','restart']){
    const button=el('button',action[0].toUpperCase()+action.slice(1),'btn');
    button.id=component?`component-${component}-${action}`:`action-${action}`;
    button.disabled=busy||s.status==='Not applied'||(action==='start'?(s.components?s.status==='Running':active):!active);
    if(action==='start'&&!button.disabled)button.classList.add('primary');
    if(component)iconButton(button,action,button.textContent);
    button.onclick=()=>act(action,serviceName,component?{component}:{});
    actions.append(button);
  }
  return actions;
}
function logSection(parent,name,title='Recent logs',controls=undefined){
  const heading=controls||el('div','','section-title');
  if(!controls)heading.append(el('h3',title));
  const load=async()=>{try{const result=await api.logs(name);if(result.error){showError(result.error);return;}logsFor=name;logText=result.text||'No logs yet.';render();$('detail').querySelector('pre')?.scrollIntoView({block:'nearest'});}catch(e){showError(e.message);}};
  const hide=()=>{logsFor='';logText='';render();};
  const logs=el('button',logsFor===name?(controls?'Hide logs':'Refresh logs'):'Show logs','link');logs.id=`logs-${name}`;logs.onclick=controls&&logsFor===name?hide:load;heading.append(logs);
  if(controls)iconButton(logs,logsFor===name?'close':'logs',logs.textContent);
  if(logsFor===name&&!controls){const close=el('button','Hide logs','link');close.onclick=hide;heading.append(close);}
  if(!controls)parent.append(heading);
  if(controls&&logsFor===name){const bar=el('div','','logs-h'),refresh=el('button','Refresh logs','link');refresh.id=`refresh-logs-${name}`;refresh.onclick=load;bar.append(el('span',title),refresh);parent.append(bar);}
  if(logsFor===name)parent.append(el('pre',logText));
}
function stateClass(s){
  const state=status(s);
  if(state==='Running')return 'running';
  if(state==='Partially running')return 'partial';
  if(['Failed','Unhealthy'].includes(state))return 'failed';
  if(['Starting','Restarting','Launching','Pending','Terminating'].includes(state))return 'starting';
  return 'stopped';
}
function stat(label,value){const node=el('div','','stat');node.append(el('span',label),el('b',String(value)));return node;}
function fact(label,value){const node=el('div','','fact');node.append(el('dt',label),el('dd',String(value)));return node;}
const cpu=s=>s.is_running&&Number.isFinite(s.cpu)?`${s.cpu.toFixed(1)}%`:null;
const memory=s=>s.is_running&&s.mem>0?`${(s.mem/1024/1024).toFixed(1)}`:null;
// Process Compose supplies elapsed time for the current run, including after Wick reopens.
const uptime=s=>s.is_running&&typeof s.system_time==='string'&&/\d/.test(s.system_time)?s.system_time:null;
function healthCheck(s){
  if(!s.hasProbe||!s.is_running)return null;
  if(s.is_ready==='Ready')return 'Passed';
  if(s.is_ready==='Not Ready')return 'Failed';
  return 'Checking';
}
function renderBand(){
  // Keep the nodes on ordinary polls so their entrance animation does not replay.
  const key=JSON.stringify([selected,services.map(s=>[s.name,status(s)])]);
  if(key===bandKey)return;
  bandKey=key;
  const counts={running:0,partial:0,failed:0,stopped:0,starting:0};
  for(const s of services)counts[stateClass(s)]++;
  const groups=services.length>18?Object.entries(counts).filter(([,n])=>n):services.map(s=>[stateClass(s),1]);
  $('band').replaceChildren(...groups.map(([state,n],i)=>{const segment=el('i','');segment.dataset.s=String(state);segment.style.flex=String(n);segment.style.setProperty('--i',String(i));return segment;}));
  const summary=$('summary');summary.replaceChildren(el('b',String(counts.running)),document.createTextNode(` of ${services.length} running`));
  const rest=Object.entries(counts).filter(([state,n])=>state!=='running'&&n);
  if(rest.length){const details=el('div','','summary-details');for(const [state,n] of rest)details.append(el('span',`${n} ${state}`));summary.append(details);}
}
function render(){
  const focused=document.activeElement;
  const focusId=focused?.id;
  const focusService=focused instanceof HTMLElement?focused.dataset.service:undefined;
  const logScroll=$('detail').querySelector('pre')?.scrollTop||0;
  const detailScroll=$('detail').parentElement.scrollTop;
  const list=$('services'),listScroll=list.scrollTop;list.replaceChildren();
  for(const s of services){const state=status(s);const button=el('button','','svc');button.dataset.service=s.name;button.dataset.s=stateClass(s);button.setAttribute('aria-current',String(selected===s.name));
    button.append(el('span','','dot '+stateClass(s)));
    button.append(el('span',s.title,'n'),el('small',state,'sr-only'));
    if(s.components&&state==='Partially running')button.append(el('span',`${s.components.filter(p=>p.is_running).length}/${s.components.length}`,'t'));
    else if(state==='Failed')button.append(el('span','fail','t'));
    button.onclick=()=>{if(selected!==s.name){selected=s.name;logsFor='';logText='';$('detail').parentElement.scrollTop=0;}render();};list.append(button);
  }
  list.scrollTop=listScroll;
  renderBand();
  const s=services.find(s=>s.name===selected);if(!s){$('crumb').textContent='';return;}
  $('crumb').textContent=s.title;document.title=`Wick · ${s.title}`;
  const detail=$('detail');detail.replaceChildren();
  const head=el('div','','head'),title=el('div',''),machine=el('div','','machine'),state=el('span','','state');
  state.dataset.s=stateClass(s);state.append(el('i','','dot '+stateClass(s)),document.createTextNode(status(s)));
  machine.append(state,el('span',`${s.components?.length||1} ${s.components?.length===1||!s.components?'process':'processes'}`));
  if(s.components)machine.append(el('span',`${s.components.filter(p=>p.is_running).length} running`));
  else if(healthCheck(s))machine.append(el('span',`Health check: ${healthCheck(s)}`,'health-check'));
  title.append(el('h1',s.title),machine);head.append(title,actionButtons(s,s.name));detail.append(head);
  if(!s.is_running&&s.restarts>=s.retryLimit)detail.append(el('p',`The automatic retry budget (${s.retryLimit}) has been used. Check logs, fix the cause, then Start to get a fresh budget.`,'hint'));
  if(!s.is_running&&signalExit(s.exit_code))detail.append(el('p','The process exited after a signal. This may be a manual stop; check logs if it was unexpected.','hint'));
  if(!s.components){
    const stats=el('div','','stats');
    if(s.is_running){
      if(s.pid>0)stats.append(stat('PID',s.pid));
      if(cpu(s)!==null)stats.append(stat('CPU',cpu(s)));
      if(memory(s)!==null)stats.append(stat('Memory',`${memory(s)} MiB`));
      if(uptime(s))stats.append(stat('Uptime',uptime(s)));
    }else if(Number.isFinite(s.exit_code))stats.append(stat('Exit code',s.exit_code));
    if(stats.childElementCount)detail.append(stats);
  }
  const panel=el('div','','card');detail.append(panel);
  if(s.url){
    const address=el('div','','addr'),addressText=el('div','','l');
    addressText.append(el('div','Address','k'),el('div',s.url,'u'));address.append(addressText);
    const open=el('button','Open in Browser ↗','link');open.id='open-browser';open.onclick=async()=>{try{const result=await api.open(s.name);showError(result.error);}catch(e){showError(e.message);}};address.append(open);panel.append(address);
  }
  const autostart=el('div','','auto-row'),autoText=el('div','');const label=el('label','Start at login','l');const toggle=document.createElement('input');toggle.type='checkbox';toggle.className='sw';toggle.id='autostart';toggle.checked=s.autostart;toggle.disabled=busy;label.htmlFor=toggle.id;
  autoText.append(label,el('div','Applies at next login. Does not change this session.','hint'));
  toggle.onchange=async()=>{const value=toggle.checked;busy=true;toggle.disabled=true;try{const result=await api.autostart(s.name,value,configToken);showError(result.error);}catch(e){showError(e.message);}finally{busy=false;await refresh();}};autostart.append(autoText,toggle);panel.append(autostart);
  if(s.components){
    detail.append(el('h3','Processes','sec-h'));
    const table=el('div','','card'),columns=el('div','','proc-head');
    for(const [text,cls] of [['Process',''],['State',''],['PID','num'],['CPU','num resource'],['MiB','num resource'],['','']])columns.append(el('div',text,cls));
    table.append(columns);detail.append(table);
    for(const component of s.components){
      const section=el('section','','component');section.dataset.component=component.name;
      const process=el('div','','proc'),identity=el('div','','identity'),name=el('div','','nm'),componentState=el('div',status(component),'st');
      componentState.dataset.s=stateClass(component);
      name.append(el('i','','dot '+stateClass(component)),el('span',component.title));identity.append(name);
      const meta=el('dl','','meta');
      if(uptime(component))meta.append(fact('Uptime',uptime(component)));
      if(component.dependencies.length)meta.append(fact('Depends on',component.dependencies.join(', ')));
      if(healthCheck(component))meta.append(fact('Health check',healthCheck(component)));
      if(component.blockedBy.length)meta.append(fact('Waiting for',component.blockedBy.join(', ')));
      if(!component.is_running&&Number.isFinite(component.exit_code))meta.append(fact('Exit code',component.exit_code));
      meta.append(fact('Restarts',component.restarts??0));
      identity.append(meta);
      const controls=el('div','','act');controls.append(actionButtons(component,s.name,component.name));
      process.append(identity,componentState);
      if(component.is_running)process.append(el('div',component.pid>0?String(component.pid):'Unavailable','num'),el('div',cpu(component)??'Unavailable','num resource'),el('div',memory(component)??'Unavailable','num resource'));
      else process.append(el('div','Not running','inactive-metrics'));
      process.append(controls);
      section.append(process);logSection(section,component.name,'Process logs',controls);
      if(!component.is_running&&component.restarts>=component.retryLimit)section.append(el('p',`Retry budget used (${component.retryLimit}). Fix the cause, then Start.`,'alert'));
      table.append(section);
    }
    detail.append(el('p','Start waits for healthy dependencies. Stop runs in reverse order.','foot'));
  }else{
    const logs=el('div','','card');logSection(logs,s.name);detail.append(logs);
    detail.append(el('p',`Restarts: ${s.restarts??0}`,'foot'));
    if(s.is_running)detail.append(el('p',`Memory is the main process RSS.${s.hasProbe?'':' No health check configured; Running only means the process is active.'}`,'foot'));
  }
  const pre=detail.querySelector('pre');if(pre)pre.scrollTop=logScroll;
  detail.parentElement.scrollTop=detailScroll;
  if(focusId)$(focusId)?.focus({preventScroll:true});
  else if(focusService)list.querySelector(`[data-service="${CSS.escape(focusService)}"]`)?.focus({preventScroll:true});
}
async function refresh(reconnect=false){
  if(busy||fetching)return;
  if(reconnect)setBackground('connecting');
  fetching=true;
  let result;
  try{result=await api.snapshot(reconnect);}catch(e){setBackground('unavailable');connectionError=true;showError(e.message);return;}finally{fetching=false;}
  setBackground(result.background);
  if(result.error){connectionError=true;showError(result.error);services=[];bandKey='';$('band').replaceChildren();$('crumb').textContent='';$('services').replaceChildren();$('detail').replaceChildren(el('p','Service state is unknown. Check the background manager and configuration.','muted'));$('summary').textContent='Service state unknown';return;}
  if(connectionError){showError('');connectionError=false;}
  services=result.services;
  configToken=result.token;
  if(!services.some(s=>s.name===selected)){selected=services[0]?.name||'';logsFor='';logText='';}
  render();
  if(!services.length)$('detail').replaceChildren(el('h1','Your local services'),el('p',`Ask your Agent to register a service. Configuration: ${result.home}/services.yaml`,'muted'));
}
$('refresh').onclick=()=>{showError('');refresh(true);};
refresh();setInterval(()=>{if(!document.hidden)refresh();},2000);
