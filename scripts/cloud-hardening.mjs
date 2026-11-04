import {assertCloudMutationAllowed} from './lib/operation-policy.mjs';
import {runAzure} from './lib/azure-cli-runtime.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {buildCloudHardeningPlan,auditCloudHardening,applyCloudHardening} from './lib/cloud-hardening.mjs';
const root=new URL('../',import.meta.url),args=process.argv.slice(2);
async function run(){
 if(args.includes('--apply'))await assertCloudMutationAllowed();
 if(args.some((arg,index)=>!['--audit','--apply','--config'].includes(arg)&&args[index-1]!=='--config'))throw Error('invalid_arguments');
 const index=args.indexOf('--config'),path=index>=0?args[index+1]:fileURLToPath(new URL('.local/cloud-target.json',root));
 if(index>=0&&!path)throw Error('config_path_required');
 let config;
 try{config=JSON.parse(await readFile(path));}
 catch(error){if(error.code!=='ENOENT'||index>=0)throw error;config=JSON.parse(await readFile(new URL('infra/cloud-target.example.json',root)));}
 const plan=buildCloudHardeningPlan(config);
 await mkdir(new URL('.local/',root),{recursive:true,mode:0o700});
 await writeFile(new URL('.local/cloud-hardening-plan.json',root),JSON.stringify(plan,null,2),{mode:0o600});
 if(args.includes('--audit')||args.includes('--apply')){
  if(args.includes('--audit')&&args.includes('--apply'))throw Error('invalid_arguments');
  const applying=args.includes('--apply');
  const result=await (applying?applyCloudHardening(plan,runAzure):auditCloudHardening(plan,runAzure));
  await writeFile(new URL(applying?'.local/cloud-hardening-application.json':'.local/cloud-hardening-audit.json',root),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify(result,null,2));
  if(applying?!result.complete:!result.allInspectedChecksPassed)process.exitCode=1;
 }else console.log(JSON.stringify(plan,null,2));
}
run().catch(error=>{console.error('cloud_hardening_not_applied:',
 ['cloud_target_required','invalid_cloud_target','invalid_arguments','config_path_required','cloud_changes_disabled_by_local_policy'].includes(error.message)?error.message:
 error.code==='ENOENT'?'config_or_azure_cli_unavailable':'configuration_or_read_only_audit_failed');process.exitCode=1;});
