const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {version}=require('../package.json');
const out=path.resolve(root,process.env.WICK_BUILD_OUT||'build');
(async()=>{
  const app=path.join(out,'Wick-darwin-arm64/Wick.app');
  const actual=execFileSync('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw',path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();
  if(actual!==version)throw new Error('App version does not match package.json. Rebuild before creating the DMG.');
  const staging=await fs.mkdtemp(path.join(os.tmpdir(),'wick-dmg-'));
  try{
    execFileSync('/usr/bin/ditto',[app,path.join(staging,'Wick.app')]);
    await fs.symlink('/Applications',path.join(staging,'Applications'));
    const image=path.join(out,`Wick-${version}-darwin-arm64.dmg`);
    execFileSync('/usr/bin/hdiutil',['create','-ov','-volname',`Wick ${version}`,
      '-srcfolder',staging,'-fs','HFS+','-format','UDZO',image],{stdio:'inherit'});
    const digest=createHash('sha256').update(await fs.readFile(image)).digest('hex');
    await fs.writeFile(image+'.sha256',`${digest}  ${path.basename(image)}\n`);
    console.log(`Created ${image}\nSHA-256 ${digest}`);
  }finally{
    await fs.rm(staging,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
