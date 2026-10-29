window.wick={
  snapshot:(reconnect=false)=>mygo.call('Console.Snapshot',reconnect),
  action:(action,name,options={})=>mygo.call('Console.Action',action,name,options),
  logs:name=>mygo.call('Console.Logs',name),
  open:name=>mygo.call('Console.Open',name),
  autostart:(name,value,token)=>mygo.call('Console.Autostart',name,value,token)
};
