const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('localdeck',{
  snapshot:(reconnect=false)=>ipcRenderer.invoke('snapshot',reconnect),
  action:(action,name)=>ipcRenderer.invoke('action',action,name),
  logs:name=>ipcRenderer.invoke('logs',name),
  open:name=>ipcRenderer.invoke('open',name),
  autostart:(name,value,token)=>ipcRenderer.invoke('autostart',name,value,token)
});
