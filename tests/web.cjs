const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const [home,name,port]=process.argv.slice(2);
const server=http.createServer((_req,res)=>res.end('LocalDeck test OK'));
server.listen(Number(port)||0,'127.0.0.1',()=>{
  fs.writeFileSync(path.join(home,`${name}.port`),String(server.address().port));
  console.log('Listening on',server.address().port);
});
