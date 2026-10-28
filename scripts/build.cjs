const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const version='1.122.0';
const checksum='eaa1238a1d6c300e928ef855d36a3d95aab8da64997104d74ea73d91d3cb6c60';
const filename='process-compose_darwin_arm64.tar.gz';
const url=`https://github.com/F1bonacc1/process-compose/releases/download/v${version}/${filename}`;
const out=path.resolve(root,process.env.WICK_BUILD_OUT||'dist');
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
    execFileSync(process.execPath,[path.join(root,'node_modules/@electron/packager/bin/electron-packager.mjs'),
      '.', 'Wick','--platform=darwin','--arch=arm64',`--out=${out}`,'--overwrite','--no-asar',
      '--icon=assets/icon.icns','--app-bundle-id=dev.wick',
      '--ignore=^/(dist|tests|docs|preview|test-results|playwright-report|\\.scratch|\\.git|\\.cache)(/|$)'
    ],{cwd:root,stdio:'inherit'});
    const resources=path.join(out,'Wick-darwin-arm64/Wick.app/Contents/Resources');
    execFileSync('/usr/bin/tar',['-xzf',archive,'-C',staging,'process-compose','LICENSE','README.md']);
    await fs.mkdir(path.join(resources,'bin'),{recursive:true});
    await fs.copyFile(path.join(staging,'process-compose'),path.join(resources,'bin/process-compose'));
    await fs.chmod(path.join(resources,'bin/process-compose'),0o755);
    const licenses=path.join(resources,'licenses/process-compose');
    await fs.mkdir(licenses,{recursive:true});
    for(const file of ['LICENSE','README.md'])await fs.copyFile(path.join(staging,file),path.join(licenses,file));
    const electronLicenses=path.join(resources,'licenses/electron');
    await fs.mkdir(electronLicenses,{recursive:true});
    for(const file of ['LICENSE','LICENSES.chromium.html']){
      await fs.copyFile(path.join(out,'Wick-darwin-arm64',file),path.join(electronLicenses,file));
    }
    await fs.chmod(path.join(resources,'app/bin/wick'),0o755);
    execFileSync('/bin/sh',[path.join(root,'scripts/set-display-name.sh')],{cwd:root,env:{...process.env,WICK_BUILD_OUT:out},stdio:'inherit'});
    console.log(`Bundled Process Compose ${version}; SHA-256 ${checksum}`);
  }finally{
    await fs.rm(staging,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
