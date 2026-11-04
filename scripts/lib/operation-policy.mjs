import {readFile} from 'node:fs/promises';
import {isLoopbackAzurite} from '../../edge/lib/local-storage.mjs';
const file=new URL('../../infra/operations-policy.json',import.meta.url);
export async function operationPolicy(){return JSON.parse(await readFile(file));}
export async function assertCloudMutationAllowed(policy){
 policy ??= await operationPolicy();
 if(policy.cloudMutationsAllowed!==true||policy.externalDeploymentAllowed!==true)throw Error('cloud_changes_disabled_by_local_policy');
}
export async function assertStorageMutationAllowed(connection,policy){
 policy ??= await operationPolicy();
 if(isLoopbackAzurite(connection)||/^UseDevelopmentStorage=true;?$/i.test(connection || ''))return;
 await assertCloudMutationAllowed(policy);
}
export async function assertAzureCommandAllowed(args,{write=false}={},policy){
 policy ??= await operationPolicy();
 const verbs=new Set(['create','update','set','delete','regenerate','restart','assign','deploy','remove','enable','disable',
  'post','put','patch','add','install','uninstall','start','stop','redeploy','swap','publish','restore','purge','rotate','insert','merge']);
 if(write||args.some(arg=>verbs.has(String(arg).toLowerCase())))await assertCloudMutationAllowed(policy);
}
