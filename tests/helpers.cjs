const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const YAML = require('yaml');
const exec = promisify(execFile);
const { ServiceManager } = require('../src/services.cjs');
async function fixture(processes = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'localdeck-test-'));
  const manager = new ServiceManager(home);
  await fs.writeFile(path.join(home, 'services.yaml'), YAML.stringify({version:'0.5', processes}));
  return {home, manager};
}
function web(home, name = 'web') {
  return {command: `exec "${process.execPath}" "${path.join(__dirname,'web.cjs')}" "${home}" "${name}"`, working_dir:home, disabled:true};
}
async function waitFor(fn, timeout = 10000) {
  const end = Date.now()+timeout;
  let error;
  while(Date.now()<end) {
    try {const result=await fn();if(result)return result;}catch(e){error=e;}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw error || new Error('Timed out waiting for service');
}
async function reachable(home, name='web') {
  return waitFor(async()=>{
    const port=await fs.readFile(path.join(home,`${name}.port`),'utf8');
    const res=await fetch(`http://127.0.0.1:${port}`, {signal:AbortSignal.timeout(500)});
    return res.ok;
  });
}
async function cleanup(manager) {try {await manager.down();}catch{} }
module.exports = {fixture, web, waitFor, reachable, cleanup, exec};
