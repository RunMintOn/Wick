const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const [home,name,port='0']=process.argv.slice(2);
const query=sql=>execFileSync('/usr/bin/sqlite3',[path.join(home,'data.sqlite'),sql],{encoding:'utf8'}).trim();
if(name==='collector')query("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS samples(value TEXT);");
const server=http.createServer(async(_req,res)=>{
 try{
  const count=name==='collector'?query('SELECT COUNT(*) FROM samples;'):await(await fetch(`http://127.0.0.1:${fs.readFileSync(path.join(home,'collector.port'),'utf8')}`)).text();
  res.end(count);
 }catch(error){res.statusCode=503;res.end(error.message);}
});
server.listen(Number(port),'127.0.0.1',()=>{
 if(name==='collector')query("INSERT INTO samples VALUES('collected');");
 fs.writeFileSync(path.join(home,`${name}.port`),String(server.address().port));
 console.log(`${name} ready`);
});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
