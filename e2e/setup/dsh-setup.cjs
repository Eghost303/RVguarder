const fs=require('fs'),os=require('os'),path=require('path');const {spawn}=require('child_process');
module.exports=async()=>{
  const tmpRoot=fs.mkdtempSync(path.join(os.tmpdir(),'rvguarder-dsh-e2e-')),home=path.join(tmpRoot,'home'),workspace=path.join(tmpRoot,'workspace'),projectDir=path.join(tmpRoot,'guard');
  fs.mkdirSync(path.join(home,'profiles','web'),{recursive:true});fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(home,'profiles','web','package.json'),JSON.stringify({dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
  fs.writeFileSync(path.join(home,'profiles','web','cordis.patch.yml'),'[]');
  const child=spawn('python',['-m','clawRVguarder.hosts.dsh.server','--project-dir',projectDir,'--dsh-home',home,'--workspace',workspace,'--profile','web','--port','0','--semantic-mode','local'],{cwd:path.resolve(__dirname,'../..'),stdio:['ignore','pipe','pipe']});
  let url,stderr='',exited=false,buffer='';child.stderr.on('data',b=>{stderr+=b;});child.on('exit',()=>{exited=true;});
  child.stdout.on('data',b=>{buffer+=b;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){try{const item=JSON.parse(line);if(item.url)url=item.url;}catch{}}});
  try{const deadline=Date.now()+20000;while(!url&&!exited&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));if(!url)throw new Error('DSH backend failed: '+stderr);
    fs.mkdirSync(path.resolve(__dirname,'../.cache'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../.cache/server.json'),JSON.stringify({url,pid:child.pid,tmpRoot,projectDir,workspace}));
  }catch(error){child.kill('SIGTERM');fs.rmSync(tmpRoot,{recursive:true,force:true});throw error;}
};
