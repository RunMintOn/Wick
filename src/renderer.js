const api=window.wick;
let selected='';
let services=[];
let busy=false;
let logsFor='';
let logText='';
let fetching=false;
let configToken='';
let connectionError=false;
const $=id=>document.getElementById(id);
// Shell wrappers report SIGTERM as 128 + 15; Process Compose may report -1.
const signalExit=code=>code===-1||code===143;
function status(s){if(s.components)return s.status;if(s.displayStatus)return s.displayStatus;if(s.status==='Not applied')return 'Not applied';if(s.is_running)return 'Running';if(s.status==='Restarting')return 'Restarting';if(s.status==='Error'||(s.status==='Completed'&&s.exit_code!==0&&!signalExit(s.exit_code)))return 'Failed';return 'Stopped';}
function el(tag,text,className=''){const node=document.createElement(tag);node.textContent=text;node.className=className;return node;}
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
    const cancel=el('button','Cancel');cancel.onclick=()=>finish(false);
    const confirm=el('button','Proceed');confirm.onclick=()=>finish(true);
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
    const button=el('button',action[0].toUpperCase()+action.slice(1),action==='start'?'primary':'');
    button.id=component?`component-${component}-${action}`:`action-${action}`;
    button.disabled=busy||s.status==='Not applied'||(action==='start'?(s.components?s.status==='Running':active):!active);
    button.onclick=()=>act(action,serviceName,component?{component}:{});
    actions.append(button);
  }
  return actions;
}
function row(label,value){const node=el('div','','row');node.append(el('span',label),el('span',value,'value'));return node;}
function logSection(parent,name,title='Recent logs'){
  const heading=el('div','','section-title');heading.append(el('h3',title));
  const logs=el('button',logsFor===name?'Refresh logs':'Show logs');logs.onclick=async()=>{const result=await api.logs(name);if(result.error){showError(result.error);return;}logsFor=name;logText=result.text||'No logs yet.';render();$('detail').querySelector('pre')?.scrollIntoView({block:'nearest'});};heading.append(logs);parent.append(heading);
  if(logsFor===name)parent.append(el('pre',logText));
}
function render(){
  const focused=document.activeElement;
  const focusId=focused?.id;
  const focusService=focused instanceof HTMLElement?focused.dataset.service:undefined;
  const logScroll=$('detail').querySelector('pre')?.scrollTop||0;
  const detailScroll=$('detail').parentElement.scrollTop;
  const list=$('services');list.replaceChildren();
  for(const s of services){const state=status(s);const button=el('button','','service'+(selected===s.name?' selected':''));button.dataset.service=s.name;
    button.append(el('span','','dot '+(state==='Running'?'running':['Failed','Partially running','Unhealthy'].includes(state)?'failed':'')));
    const text=el('span','');text.append(el('strong',s.title),el('small',state));button.append(text);button.onclick=()=>{selected=s.name;render();};list.append(button);
  }
  $('summary').textContent=`${services.filter(s=>s.is_running).length} running · ${services.length} services`;
  const s=services.find(s=>s.name===selected);if(!s)return;
  const detail=$('detail');detail.replaceChildren(el('h2',s.title),el('span',status(s),'muted'));
  detail.append(actionButtons(s,s.name));
  if(!s.is_running&&s.restarts>=s.retryLimit)detail.append(el('p',`The automatic retry budget (${s.retryLimit}) has been used. Check logs, fix the cause, then Start to get a fresh budget.`,'hint'));
  if(!s.is_running&&signalExit(s.exit_code))detail.append(el('p','The process exited after a signal. This may be a manual stop; check logs if it was unexpected.','hint'));
  const address=row('Address',s.url||'—');
  if(s.url){
    const open=el('button','Open in Browser ↗','link-button');open.id='open-browser';open.onclick=async()=>{const result=await api.open(s.name);showError(result.error);};
    const value=address.lastElementChild;value.classList.add('address-value');value.replaceChildren(el('span',s.url),open);
  }
  const panel=el('div','','panel');panel.append(row('Status',status(s)));
  if(!s.components)panel.append(row('PID',s.is_running?String(s.pid):'—'),row('CPU',s.is_running&&Number.isFinite(s.cpu)?`${s.cpu.toFixed(1)}%`:'—'),row('Memory',s.is_running&&s.mem>0?`${(s.mem/1024/1024).toFixed(1)} MiB`:'—'),row('Exit code',s.is_running?'—':String(s.exit_code??'—')),row('Restarts',String(s.restarts??0)));
  panel.append(address);detail.append(panel);
  const autostart=el('div','','row');const label=el('label','Start at login');const toggle=document.createElement('input');toggle.type='checkbox';toggle.id='autostart';toggle.checked=s.autostart;toggle.disabled=busy;label.htmlFor=toggle.id;
  toggle.onchange=async()=>{const value=toggle.checked;busy=true;toggle.disabled=true;const result=await api.autostart(s.name,value,configToken);busy=false;showError(result.error);await refresh();};autostart.append(label,toggle);panel.append(autostart);
  detail.append(el('p','Login settings apply at the next background startup. They do not start or stop this service now.','hint'));
  if(!s.components)detail.append(el('p','Memory is the main process RSS. Running does not guarantee the web page is ready.','hint'));
  if(s.components){
    detail.append(el('h3','Processes'));
    for(const component of s.components){
      const section=el('section','','panel component');section.dataset.component=component.name;
      section.append(row(component.title,status(component)),row('PID',component.is_running?String(component.pid):'—'),
        row('Depends on',component.dependencies.join(', ')||'—'),row('Readiness',component.is_ready||'—'),
        row('Exit code',component.is_running?'—':String(component.exit_code??'—')),row('Restarts',String(component.restarts??0)));
      if(component.blockedBy.length)section.append(el('p',`Waiting for: ${component.blockedBy.join(', ')}`,'hint'));
      section.append(actionButtons(component,s.name,component.name));
      logSection(section,component.name,'Process logs');detail.append(section);
    }
  }else logSection(detail,s.name);
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
  if(result.error){connectionError=true;showError(result.error);services=[];$('services').replaceChildren();$('detail').replaceChildren(el('p','Service state is unknown. Check the background manager and configuration.','muted'));$('summary').textContent='Service state unknown';return;}
  if(connectionError){showError('');connectionError=false;}
  services=result.services;
  configToken=result.token;
  if(!services.some(s=>s.name===selected))selected=services[0]?.name||'';
  render();
  if(!services.length)$('detail').replaceChildren(el('h2','Your local services'),el('p',`Ask your Agent to register a service. Configuration: ${result.home}/services.yaml`,'muted'));
}
$('refresh').onclick=()=>{showError('');refresh(true);};
refresh();setInterval(()=>{if(!document.hidden)refresh();},2000);
