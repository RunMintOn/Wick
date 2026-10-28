const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('wick',{
  snapshot:(reconnect=false)=>ipcRenderer.invoke('snapshot',reconnect),
  action:(action,name,options={})=>ipcRenderer.invoke('action',action,name,options),
  logs:name=>ipcRenderer.invoke('logs',name),
  open:name=>ipcRenderer.invoke('open',name),
  autostart:(name,value,token)=>ipcRenderer.invoke('autostart',name,value,token)
});
