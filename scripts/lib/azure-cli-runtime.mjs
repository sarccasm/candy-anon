import {assertAzureCommandAllowed} from './operation-policy.mjs';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),root=new URL('../../',import.meta.url);
export async function azureRuntime(){
 const directory=new URL('.local/azure-auth/',root);await mkdir(directory,{recursive:true,mode:0o700});
 const local=fileURLToPath(new URL('.local/azure-cli/bin/az',root));
 return {binary:process.env.CANDY_AZ_PATH || (existsSync(local)?local:'az'),
  env:{...process.env,AZURE_CONFIG_DIR:fileURLToPath(directory),AZURE_CORE_LOGIN_EXPERIENCE_V2:'off'}};
}
export async function runAzure(args,{write=false}={}){
 await assertAzureCommandAllowed(args,{write});
 const {binary,env}=await azureRuntime();
 const {stdout}=await execute(binary,[...args,'--output',write?'none':'json','--only-show-errors'],
  {env,maxBuffer:4*1024*1024,timeout:120000});
 return write?null:JSON.parse(stdout);
}
