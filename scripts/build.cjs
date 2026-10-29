const fs=require('node:fs/promises');
const {existsSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const version='1.122.0';
const checksum='eaa1238a1d6c300e928ef855d36a3d95aab8da64997104d74ea73d91d3cb6c60';
const filename='process-compose_darwin_arm64.tar.gz';
const url=`https://github.com/F1bonacc1/process-compose/releases/download/v${version}/${filename}`;
const out=path.resolve(root,process.env.WICK_BUILD_OUT||'build');
(async()=>{
  if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Build Wick on an Apple Silicon Mac.');
  const cache=path.join(root,'.cache',`process-compose-${version}`);
  await fs.mkdir(cache,{recursive:true});
  const archive=path.join(cache,filename);
  const staging=await fs.mkdtemp(path.join(os.tmpdir(),'wick-pc-'));
  try{
    let bytes=await fs.readFile(archive).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
    if(!bytes){
      console.log(`Downloading Process Compose ${version} (arm64)…`);
      execFileSync('/usr/bin/curl',['--fail','--location','--retry','2','--connect-timeout','20',
        '--max-time','180','--output',path.join(staging,filename),url],{stdio:'inherit'});
      bytes=await fs.readFile(path.join(staging,filename));
    }
    if(createHash('sha256').update(bytes).digest('hex')!==checksum)throw new Error(`Process Compose checksum mismatch. Move ${archive} to Trash and retry.`);
    await fs.writeFile(archive,bytes);
    const {version:appVersion}=require('../package.json');
    const contents=path.join(out,'Wick-darwin-arm64/Wick.app/Contents');
    const resources=path.join(contents,'Resources');
    if(existsSync(path.dirname(contents)))execFileSync('/usr/bin/trash',[path.dirname(contents)]);
    await fs.mkdir(path.join(contents,'MacOS'),{recursive:true});
    await fs.mkdir(path.join(resources,'app/bin'),{recursive:true});
    execFileSync('go',['build','-trimpath','-tags','mygo_noinspector',
      '-ldflags',`-s -w -X main.version=${appVersion} -X github.com/egoist/mygo.production=1`,
      '-o',path.join(contents,'MacOS/Wick'),'.'],
    {cwd:root,env:{...process.env,CGO_ENABLED:'0'},stdio:'inherit'});
    await fs.writeFile(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Wick</string>
<key>CFBundleDisplayName</key><string>Wick</string>
<key>CFBundleExecutable</key><string>Wick</string>
<key>CFBundleIdentifier</key><string>dev.wick</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${appVersion}</string>
<key>CFBundleVersion</key><string>${appVersion}</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
    await fs.copyFile(path.join(root,'assets/icon.icns'),path.join(resources,'icon.icns'));
    await fs.copyFile(path.join(root,'bin/wick'),path.join(resources,'app/bin/wick'));
    await fs.cp(path.join(root,'skills'),path.join(resources,'app/skills'),{recursive:true});
    for(const file of ['package.json','LICENSE','THIRD-PARTY-NOTICES.md'])
      await fs.copyFile(path.join(root,file),path.join(resources,'app',file));
    execFileSync('/usr/bin/tar',['-xzf',archive,'-C',staging,'process-compose','LICENSE','README.md']);
    await fs.mkdir(path.join(resources,'bin'),{recursive:true});
    await fs.copyFile(path.join(staging,'process-compose'),path.join(resources,'bin/process-compose'));
    await fs.chmod(path.join(resources,'bin/process-compose'),0o755);
    const licenses=path.join(resources,'licenses/process-compose');
    await fs.mkdir(licenses,{recursive:true});
    for(const file of ['LICENSE','README.md'])await fs.copyFile(path.join(staging,file),path.join(licenses,file));
    const linked=new Set(execFileSync('go',['list','-deps','-f','{{if .Module}}{{.Module.Path}}{{end}}','.'],
      {cwd:root,env:{...process.env,CGO_ENABLED:'0'},encoding:'utf8'}).trim().split('\n'));
    const modules=execFileSync('go',['list','-m','-json','all'],{cwd:root,encoding:'utf8'})
      .trim().split(/\n}\n(?={)/).map((part,i,all)=>JSON.parse(part+(i<all.length-1?'\n}':'')));
    const goLicenses=path.join(resources,'licenses/go');
    await fs.mkdir(goLicenses,{recursive:true});
    const dependencies=modules.filter(m=>!m.Main&&linked.has(m.Path));
    await fs.writeFile(path.join(goLicenses,'modules.txt'),dependencies
      .map(m=>`${m.Path} ${m.Version}`).join('\n')+'\n');
    for(const module of dependencies){
      const target=path.join(goLicenses,module.Path);
      await fs.mkdir(target,{recursive:true});
      for(const file of await fs.readdir(module.Dir)){
        if(/^(LICENSE|COPYING|COPYRIGHT|NOTICE|PATENTS)(\.|$)/i.test(file))
          await fs.copyFile(path.join(module.Dir,file),path.join(target,file));
      }
    }
    await fs.chmod(path.join(resources,'app/bin/wick'),0o755);
    console.log(`Built ${path.dirname(contents)} with MyGo; bundled Process Compose ${version}.`);
  }finally{
    await fs.rm(staging,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
