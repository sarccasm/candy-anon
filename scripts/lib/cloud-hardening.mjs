const required=['subscriptionId','resourceGroup','functionAppName','storageAccountName','frontendOrigin','adminOrigin'];
function validOrigin(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash&&url.origin===value;}catch{return false;}}
export function buildCloudHardeningPlan(config={}) {
 const missing=required.filter(name=>!config[name]);
 if(missing.length)return {configured:false,missing,applied:false,operations:[],
  outstanding:['azure_target_required','cloudflare_zone_and_alert_action_group_require_owner_configuration']};
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.subscriptionId)||!/^[-\w.()]{1,90}$/.test(config.resourceGroup)||
  !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,58}[a-zA-Z0-9]$/.test(config.functionAppName)||
  !/^[a-z0-9]{3,24}$/.test(config.storageAccountName)||!validOrigin(config.frontendOrigin)||!validOrigin(config.adminOrigin))
  throw Error('invalid_cloud_target');
 const siteId=`/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}/providers/Microsoft.Web/sites/${config.functionAppName}`;
 const storageId=`/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}/providers/Microsoft.Storage/storageAccounts/${config.storageAccountName}`;
 const common=['--subscription',config.subscriptionId,'--resource-group',config.resourceGroup,'--name',config.functionAppName];
 const origins=[...new Set([config.frontendOrigin,config.adminOrigin])];
 const operations=[
  {id:'require_https',args:['functionapp','update',...common,'--https-only','true']},
  {id:'tls_cors_and_ftps',args:['resource','update','--ids',siteId+'/config/web','--api-version','2024-04-01','--set',
   'properties.minTlsVersion=1.2','properties.scmMinTlsVersion=1.2','properties.ftpsState=Disabled',
   'properties.cors.supportCredentials=false','properties.cors.allowedOrigins='+JSON.stringify(origins)]},
  {id:'storage_tls_and_no_anonymous_blobs',args:['storage','account','update','--subscription',config.subscriptionId,
   '--resource-group',config.resourceGroup,'--name',config.storageAccountName,'--https-only','true','--min-tls-version','TLS1_2','--allow-blob-public-access','false']},
  {id:'bounded_requests_and_optional_features_off',args:['functionapp','config','appsettings','set',...common,'--settings',
   'FUNCTIONS_REQUEST_BODY_SIZE_LIMIT=65536','ENABLE_ESCROW_PURGE=false','ENABLE_ANALYTICS=false']}
 ];
 return {configured:true,applied:false,target:{subscriptionId:config.subscriptionId,resourceGroup:config.resourceGroup,
  functionAppName:config.functionAppName,storageAccountName:config.storageAccountName},siteId,storageId,origins,
  operations:operations.map(operation=>({...operation,executable:'az',requiresReview:true})),
  outstanding:['origin_bypass_restrictions_require_actual_gateway_and_admin_networks',
   'cloudflare_rate_cache_and_admin_access_rules_require_account_plan_review',
   'secret_rotation_and_key_vault_permissions_require_owner_verification',
   'alerts_require_action_group_workspace_and_telemetry_validation',
   'checkout_policy_and_legacy_invoice_migration_require_separate_review']};
}
export async function auditCloudHardening(plan,runAz) {
 if(!plan.configured)throw Error('cloud_target_required');
 const common=['--subscription',plan.target.subscriptionId,'--resource-group',plan.target.resourceGroup,'--name',plan.target.functionAppName];
 const [site,web,storage,settingNames]=await Promise.all([
  runAz(['functionapp','show',...common,'--query','{httpsOnly:httpsOnly,identityType:identity.type}']),
  runAz(['functionapp','config','show',...common,'--query','{minTlsVersion:minTlsVersion,scmMinTlsVersion:scmMinTlsVersion,ftpsState:ftpsState,cors:cors,originDefault:ipSecurityRestrictionsDefaultAction}']),
  runAz(['storage','account','show','--subscription',plan.target.subscriptionId,'--resource-group',plan.target.resourceGroup,
   '--name',plan.target.storageAccountName,'--query','{httpsOnly:enableHttpsTrafficOnly,minTlsVersion:minimumTlsVersion,allowBlobPublicAccess:allowBlobPublicAccess}']),
  // Only names and Key Vault-reference booleans leave the CLI. Never return values.
  runAz(['functionapp','config','appsettings','list',...common,'--query',"[].{name:name,keyVault:starts_with(value, '@Microsoft.KeyVault(')}"])
 ]);
 const checks={httpsOnly:site.httpsOnly===true,applicationTls:web.minTlsVersion==='1.2'||web.minTlsVersion==='1.3',
  scmTls:web.scmMinTlsVersion==='1.2'||web.scmMinTlsVersion==='1.3',ftpsDisabled:web.ftpsState==='Disabled',
  exactCors:Array.isArray(web.cors?.allowedOrigins)&&web.cors.allowedOrigins.length===plan.origins.length&&plan.origins.every(origin=>web.cors.allowedOrigins.includes(origin)),
  corsCredentialsOff:web.cors?.supportCredentials===false,storageHttps:storage.httpsOnly===true,
  storageTls:storage.minTlsVersion==='TLS1_2'||storage.minTlsVersion==='TLS1_3',anonymousBlobsOff:storage.allowBlobPublicAccess===false,
  adminSecretInVault:settingNames.some(item=>item.name==='ADMIN_KEY'&&item.keyVault===true),
  storageSecretInVault:settingNames.some(item=>item.name==='AZURE_STORAGE_CONNECTION_STRING'&&item.keyVault===true)};
 return {checkedAt:new Date().toISOString(),readOnly:true,valuesIncluded:false,checks,
  allInspectedChecksPassed:Object.values(checks).every(Boolean),releaseApproved:false,outstanding:plan.outstanding};
}

export async function applyCloudHardening(plan,runAz){
 if(!plan.configured)throw Error('cloud_target_required');
 const before=await auditCloudHardening(plan,runAz),completed=[];
 let failedOperation=null;
 for(const operation of plan.operations){
  try {await runAz(operation.args,{write:true});completed.push(operation.id);}
  catch{failedOperation=operation.id;break;}
 }
 let after=null;
 try {after=await auditCloudHardening(plan,runAz);}catch{}
 return {checkedAt:new Date().toISOString(),applied:completed.length>0,completed,failedOperation,before,after,
  releaseApproved:false,complete:!failedOperation&&!!after?.allInspectedChecksPassed};
}
