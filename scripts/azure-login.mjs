import {spawn} from 'node:child_process';
import {azureRuntime,runAzure} from './lib/azure-cli-runtime.mjs';
try {
 const runtime=await azureRuntime();
 console.log('Sign in through Microsoft. Credentials are cached only in the ignored .local/azure-auth folder.');
 const code=await new Promise((resolve,reject)=>{
  const child=spawn(runtime.binary,['login','--use-device-code','--output','none','--only-show-errors'],{env:runtime.env,stdio:'inherit'});
  child.on('error',reject);child.on('exit',resolve);
 });
 if(code!==0){
  console.error('Microsoft sign-in returned no usable Azure subscription. Cloud changes remain disabled.');
  process.exitCode=1;
 }else{
 const account=await runAzure(['account','show','--query','{subscriptionId:id,name:name,state:state}']);
 console.log(JSON.stringify({authenticated:true,subscription:account}));
 }
}catch{console.error('Azure sign-in not completed. Install the project-local CLI and retry.');process.exitCode=1;}
