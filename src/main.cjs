const {app,BrowserWindow,ipcMain,Menu,shell}=require('electron');
const path=require('node:path');
const {ServiceManager}=require('./services.cjs');
const {installLogin}=require('./login.cjs');
const manager=new ServiceManager();
if(process.env.WICK_HOME){
  const profile=path.join(manager.home,'console');
  require('node:fs').mkdirSync(profile,{recursive:true,mode:0o700});
  app.setPath('userData',profile);
}
let window;
function createWindow(){
  window=new BrowserWindow({show:process.env.WICK_HEADLESS!=='1',width:960,height:680,minWidth:720,minHeight:500,title:'Wick',titleBarStyle:'hiddenInset',backgroundColor:'#f5f5f7',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.loadFile(path.join(__dirname,'index.html'));
}
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(()=>{
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Wick',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'quit'}]},{label:'Edit',submenu:[{role:'copy'},{role:'selectAll'}]},{label:'Window',submenu:[{role:'minimize'},{role:'close'}]}]));
    async function connect(){
      if(process.env.WICK_HOME){await manager.ensure();return {};}
      await installLogin(manager);
      for(let i=0;i<50;i++){if(await manager.connected())return {};await new Promise(r=>setTimeout(r,100));}
      throw new Error('Login background manager did not start. Check configuration and startup.log.');
    }
    let ready=connect().catch(e=>({error:e.message}));
    ipcMain.handle('snapshot',async(_event,reconnect=false)=>{
      try{
        if(reconnect)ready=connect().catch(e=>({error:e.message}));
        const initial=await ready;
        const snapshot=await manager.snapshot();
        if('error' in initial&&snapshot.background==='unavailable')return {...snapshot,error:`${snapshot.error}\n${initial.error}`};
        return snapshot;
      }catch(e){return {background:'unavailable',error:e.message,home:manager.home,services:[]};}
    });
    ipcMain.handle('autostart',async(_event,name,value,token)=>{try{await manager.setAutostart(name,value,token);if(!process.env.WICK_HOME)await installLogin(manager);return {};}catch(e){return {error:e.message};}});
    ipcMain.handle('logs',async(_event,name)=>{try{return {text:await manager.logs(name)};}catch(e){return {error:e.message};}});
    ipcMain.handle('open',async(_event,name)=>{try{await shell.openExternal(await manager.serviceUrl(name));return {};}catch(e){return {error:e.message};}});
    ipcMain.handle('action',async(_event,action,name,options={})=>{try{await manager.action(action,name,options);return {ok:true};}catch(e){return {error:e.message,requiresConfirmation:e.requiresConfirmation,affected:e.affected};}});
    createWindow();
  });
  app.on('window-all-closed',()=>app.quit());
}
