interface Window {
  localdeck: {
    snapshot(reconnect?:boolean): Promise<any>;
    action(action:string,name:string):Promise<{ok?:boolean,error?:string}>;
    logs(name:string):Promise<{text?:string,error?:string}>;
    open(name:string):Promise<{error?:string}>;
    autostart(name:string,value:boolean,token:string):Promise<{error?:string}>;
  };
}
