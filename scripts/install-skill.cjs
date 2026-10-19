const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const source=path.resolve(__dirname,'../skills/wick');
  const target=path.join(os.homedir(),'.agents','skills','wick');
  await fs.mkdir(path.dirname(target),{recursive:true});
  const existing=await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(existing){
    if(existing.isSymbolicLink()&&await fs.realpath(target)===await fs.realpath(source)){console.log(`Wick Skill is already installed: ${target}`);return;}
    throw new Error(`Existing Skill is preserved. Choose how to handle ${target} before installing.`);
  }
  await fs.symlink(source,target,'dir');
  console.log(`Installed Wick Skill: ${target}`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
