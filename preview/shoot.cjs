const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('force-device-scale-factor', '2');
if (app.dock) app.dock.hide();

const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  const win = new BrowserWindow({ width: 960, height: 680, show: false, frame: false });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('FAIL', code, desc, url));

  const save = async out => {
    fs.writeFileSync(path.join(__dirname, 'shots', out), (await win.webContents.capturePage()).toPNG());
    console.log('shot', out);
  };
  const open = async file => { await win.loadFile(path.join(__dirname, file)); await wait(400); };
  const click = async sel => {
    await win.webContents.executeJavaScript(`(()=>{const n=document.querySelector(${JSON.stringify(sel)});if(n)n.click();return !!n})()`);
    await wait(280);
  };

  nativeTheme.themeSource = 'light';
  for (const name of ['ember', 'paper', 'native', 'terminal']) {
    await open(name + '.html');
    await save(name + '.png');
  }

  await open('ember.html');
  await click('.svc[data-n="Neko Master"]');
  await save('ember-single.png');
  await click('[data-a="logs"]');
  await win.webContents.executeJavaScript(`document.querySelector('.scroll').scrollTop=900`);
  await wait(250);
  await save('ember-single-logs.png');
  await click('.svc[data-n="dsh"]');
  await save('ember-stopped.png');
  await click('.svc[data-n="UniChat"]');
  await click('.proc [data-a="logs"]');
  await win.webContents.executeJavaScript(`document.querySelector('.scroll').scrollTop=900`);
  await wait(250);
  await save('ember-logs.png');

  for (const name of ['paper', 'native', 'terminal']) {
    await open(name + '.html');
    await click('.svc[data-n="Neko Master"]');
    await save(name + '-single.png');
  }

  await open('slate.html');
  await save('slate.png');
  await click('.svc[data-n="Neko Master"]');
  await save('slate-single.png');
  await click('[data-a="logs"]');
  await save('slate-single-logs.png');
  await win.loadFile(path.join(__dirname, 'slate.html'), { query: { many: '1' } });
  await wait(500);
  await save('slate-many.png');

  await open('graphite.html');
  await save('graphite.png');
  await click('.svc[data-n="Neko Master"]');
  await save('graphite-single.png');
  await win.loadFile(path.join(__dirname, 'graphite.html'), { query: { many: '1' } });
  await wait(500);
  await save('graphite-many.png');

  nativeTheme.themeSource = 'dark';
  await open('native.html');
  await save('native-dark.png');
  nativeTheme.themeSource = 'light';

  win.setContentSize(1440, 900);
  await open('ember.html');
  await save('ember-wide.png');
  await open('native.html');
  await save('native-wide.png');
  await open('slate.html');
  await save('slate-wide.png');
  await open('graphite.html');
  await save('graphite-wide.png');

  win.setContentSize(1180, 1760);
  await open('index.html');
  await wait(700);
  await save('index.png');
  app.quit();
}).catch(err => { console.error(err); app.quit(); });
