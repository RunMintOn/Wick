const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fs,path,exec,root,evidence,waitFor,setup,rpc}=require('./helpers.cjs');

test('actual hidden WKWebView renders services, operates them and leaves them running on close',async t=>{
  const c=await setup(t,'wick-webview');
  await exec('go',['build','-tags','e2e','-o',c.executable,'.'],{cwd:root});
  const socket=path.join(c.home,'automation.sock');
  c.env.MYGO_AUTOMATION=socket;
  const child=await c.launch('webview');
  await waitFor(()=>fs.access(socket).then(()=>true));
  const evaluate=async script=>(await rpc(socket,'eval',{script})).value;
  await waitFor(async()=>await evaluate('document.querySelector("#background-label")?.textContent')==='Connected');
  const windows=(await rpc(socket,'windows')).windows;
  assert.equal(windows.length,1);
  assert.equal(windows[0].visible,false);
  assert.match(windows[0].url,/^mygo:/);
  assert.equal(await evaluate('document.querySelector("h1").textContent'),'Your local services');
  await fs.writeFile(path.join(c.data,'services.yaml'),`version: "0.5"
processes:
  example:
    command: "exec ${c.service} ${c.data} example"
    disabled: true
    x-wick:
      title: Example Service
      url: http://localhost:5231
`);
  await c.run('apply');
  await evaluate('refresh()');
  assert.equal(await evaluate('document.querySelector("h1").textContent'),'Example Service');
  await evaluate('document.querySelector("#action-start").click()');
  await waitFor(async()=>await evaluate('document.querySelector(".machine .state").textContent')==='Running');
  const before=JSON.parse((await c.run('list')).stdout);
  const pid=before.services[0].pid;
  assert.ok(pid>0);
  const address=await fs.readFile(path.join(c.data,'example.address'),'utf8');
  assert.equal(await (await fetch(address)).text(),'wick-installed-example');
  await evaluate('document.querySelector("#autostart").click()');
  await waitFor(async()=>JSON.parse((await c.run('list')).stdout).services[0].autostart);
  assert.equal(JSON.parse((await c.run('list')).stdout).services[0].pid,pid);
  await evaluate('document.querySelector("#logs-example").click()');
  await waitFor(async()=>String(await evaluate('document.querySelector("pre")?.textContent')).includes('ready example'));
  await evaluate("window.confirmed=undefined;confirmImpact('Dependency impact').then(value=>window.confirmed=value);true");
  assert.equal(await evaluate('document.querySelector("dialog[open]").textContent.includes("Dependency impact")'),true);
  await evaluate('document.querySelector("dialog[open] button").click()');
  await waitFor(async()=>await evaluate('window.confirmed')===false);
  const capture=await rpc(socket,'capture');
  await fs.writeFile(path.join(evidence,'console.png'),Buffer.from(capture.png,'base64'));
  const layout=await evaluate(`JSON.stringify({
    width:innerWidth,height:innerHeight,
    sidebar:document.querySelector('aside').getBoundingClientRect().width,
    background:getComputedStyle(document.body).backgroundColor,
    toggle:getComputedStyle(document.querySelector('#autostart')).webkitAppearance,
    overflow:document.documentElement.scrollWidth>innerWidth
  })`);
  assert.equal(JSON.parse(layout).overflow,false);
  await evaluate('window.mygo.window.close()').catch(()=>{});
  await waitFor(()=>child.exitCode!==null||child.signalCode!==null);
  const after=JSON.parse((await c.run('list')).stdout);
  assert.equal(after.services[0].pid,pid);
  assert.equal(await (await fetch(address)).text(),'wick-installed-example');
  await fs.writeFile(path.join(evidence,'webview.json'),JSON.stringify({
    app:c.app,windows,layout:JSON.parse(layout),servicePIDBeforeClose:pid,servicePIDAfterClose:after.services[0].pid,
    screenshot:path.join(evidence,'console.png'),backend:'WKWebView'
  },null,2));
});
