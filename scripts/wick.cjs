const [command,...args]=process.argv.slice(2);
const commands={
  list:'service.cjs',start:'service.cjs',stop:'service.cjs',restart:'service.cjs',
  validate:'config.cjs',apply:'config.cjs',recover:'recover.cjs','skill:install':'install-skill.cjs'
};
if(!command||command==='--help'){
  console.log('Usage: wick list | start|stop|restart <service> [process] [--confirm-impact] | validate | apply | recover <service> | skill:install');
}else if(!Object.hasOwn(commands,command)){
  console.error(`Unknown command: ${command}`);process.exitCode=1;
}else if(['validate','apply','skill:install'].includes(command)&&args.length){
  console.error(`${command} does not accept arguments.`);process.exitCode=1;
}else{
  const forwarded=['list','start','stop','restart'].includes(command)?[command,...args]:command==='validate'?['--check']:args;
  process.argv=[process.execPath,require('node:path').join(__dirname,commands[command]),...forwarded];
  require('./'+commands[command]);
}
