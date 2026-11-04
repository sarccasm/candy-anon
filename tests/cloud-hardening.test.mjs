import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCloudHardeningPlan,auditCloudHardening} from '../scripts/lib/cloud-hardening.mjs';
import {classifyCredential,rotationAction} from '../scripts/lib/credential-classification.mjs';
const config={subscriptionId:'11111111-1111-4111-8111-111111111111',resourceGroup:'test-rg',functionAppName:'test-candy-app',
 storageAccountName:'testcandystore',frontendOrigin:'https://shop.example.test',adminOrigin:'https://admin.example.test'};
test('missing cloud details produce no operations and never imply deployment',()=>{
 const plan=buildCloudHardeningPlan({});assert.equal(plan.configured,false);assert.equal(plan.applied,false);assert.deepEqual(plan.operations,[]);
});
test('hardening plan targets explicit resources without regenerating keys or changing active payment timers',()=>{
 const plan=buildCloudHardeningPlan(config);assert.equal(plan.configured,true);assert.equal(plan.applied,false);
 for(const operation of plan.operations){assert.equal(operation.requiresReview,true);assert.equal(operation.executable,'az');}
 const serialized=JSON.stringify(plan.operations);
 for(const forbidden of ['regenerate','delete','AzureWebJobs.ProcessPayments.Disabled','ADMIN_KEY=','AccountKey='])assert.equal(serialized.includes(forbidden),false);
 assert.ok(serialized.includes('properties.scmMinTlsVersion=1.2'));
});
test('wildcard, cleartext, credential-bearing and path-based origins are rejected',()=>{
 for(const frontendOrigin of ['*','http://shop.example.test','https://user:secret@shop.example.test','https://shop.example.test/path'])
  assert.throws(()=>buildCloudHardeningPlan({...config,frontendOrigin}),/invalid_cloud_target/);
});
test('cloud audit executes only reads and reports booleans, not app setting secrets',async()=>{
 const commands=[];
 const audit=await auditCloudHardening(buildCloudHardeningPlan(config),async args=>{
  commands.push(args);
  if(args[0]==='storage')return {httpsOnly:true,minTlsVersion:'TLS1_2',allowBlobPublicAccess:false};
  if(args.includes('appsettings'))return [{name:'ADMIN_KEY',keyVault:true},{name:'AZURE_STORAGE_CONNECTION_STRING',keyVault:true}];
  if(args.includes('config'))return {minTlsVersion:'1.2',scmMinTlsVersion:'1.2',ftpsState:'Disabled',cors:{allowedOrigins:[config.frontendOrigin,config.adminOrigin],supportCredentials:false}};
  return {httpsOnly:true};
 });
 assert.equal(audit.allInspectedChecksPassed,true);assert.equal(audit.releaseApproved,false);
 for(const args of commands)assert.ok(args.includes('show')||args.includes('list'));
 assert.equal(JSON.stringify(audit).includes('ADMIN_KEY'),false);
});
test('credential inventory distinguishes a private-key path, public XPUB, weak default and actual private material',()=>{
 assert.equal(classifyCredential('PGP_PRIVATE_KEY_PATH','/private/key.asc'),'private_key_location_reference');
 assert.equal(classifyCredential('XPUB','public-value'),'public_wallet_identifier');
 assert.equal(classifyCredential('ADMIN_KEY','dev123'),'weak_default');
 assert.equal(classifyCredential('PRIVATE_KEY','-----BEGIN PRIVATE KEY-----\nABC'),'private_key_material');
 assert.equal(classifyCredential('XPUB','xprv'+'1'.repeat(100)),'private_key_material');
 assert.equal(rotationAction('HMAC_SECRET','potentially_live_secret'),'retire_from_new_runtime_keep_recovery_material_if_required');
});

test('hardening executor preserves partial progress and never serializes write outputs',async()=>{
 const {applyCloudHardening}=await import('../scripts/lib/cloud-hardening.mjs');
 let writes=0;
 const result=await applyCloudHardening(buildCloudHardeningPlan(config),async(args,options={})=>{
  if(options.write){if(++writes===2)throw Error('PRIVATE provider error');return {secret:'PRIVATE write result'};}
  if(args[0]==='storage')return {httpsOnly:true,minTlsVersion:'TLS1_2',allowBlobPublicAccess:false};
  if(args.includes('appsettings'))return [{name:'ADMIN_KEY',keyVault:true},{name:'AZURE_STORAGE_CONNECTION_STRING',keyVault:true}];
  if(args.includes('config'))return {minTlsVersion:'1.2',scmMinTlsVersion:'1.2',ftpsState:'Disabled',cors:{allowedOrigins:[config.frontendOrigin,config.adminOrigin],supportCredentials:false}};
  return {httpsOnly:true};
 });
 assert.deepEqual(result.completed,['require_https']);assert.equal(result.failedOperation,'tls_cors_and_ftps');
 assert.equal(result.complete,false);assert.equal(result.releaseApproved,false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
