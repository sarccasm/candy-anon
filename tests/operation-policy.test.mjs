import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCloudMutationAllowed,assertStorageMutationAllowed,assertAzureCommandAllowed,operationPolicy} from '../scripts/lib/operation-policy.mjs';
import {connection} from '../edge/scripts/local-config.mjs';
test('workspace policy prohibits paid resources and external deployment',async()=>{
 const policy=await operationPolicy();assert.equal(policy.mode,'local-only');assert.equal(policy.paidResourcesAllowed,false);
 await assert.rejects(()=>assertCloudMutationAllowed(),/cloud_changes_disabled/);
});
test('local Azurite writes remain possible but cloud storage mutations are rejected',async()=>{
 await assertStorageMutationAllowed(connection);await assertStorageMutationAllowed('UseDevelopmentStorage=true');
 await assert.rejects(()=>assertStorageMutationAllowed('DefaultEndpointsProtocol=https;AccountName=realcloud;AccountKey=placeholder'),/cloud_changes_disabled/);
});
test('Azure reads are allowed while writes cannot bypass the policy by omitting a write option',async()=>{
 await assertAzureCommandAllowed(['account','list']);
 await assertAzureCommandAllowed(['functionapp','config','show','--name','candy-app']);
 for(const args of [['group','create'],['storage','account','update'],['rest','--method','POST'],['functionapp','restart']])
  await assert.rejects(()=>assertAzureCommandAllowed(args),/cloud_changes_disabled/);
 await assert.rejects(()=>assertAzureCommandAllowed(['resource','show'],{write:true}),/cloud_changes_disabled/);
});
