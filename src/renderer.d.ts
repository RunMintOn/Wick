interface Window {
  wick: {
    snapshot(reconnect?:boolean): Promise<any>;
    action(action:string,name:string,options?:{component?:string,confirmImpact?:boolean}):Promise<{ok?:boolean,error?:string,requiresConfirmation?:boolean,affected?:string[]}>;
    logs(name:string):Promise<{text?:string,error?:string}>;
    open(name:string):Promise<{error?:string}>;
    autostart(name:string,value:boolean,token:string):Promise<{error?:string}>;
  };
}
