import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const git=args=>execFileSync('git',args,{cwd:fileURLToPath(root),encoding:'utf8',maxBuffer:4*1024*1024});
const risky=path=>/(^|\/)(\.env(?:\.[^/]+)?|local\.settings\.json)$|\.(?:key|pem|pfx|p12)$/i.test(path)&&!path.endsWith('.env.example');
const tracked=git(['ls-files','-z']).split('\0').filter(Boolean);
const historical=[...new Set(git(['log','--all','--format=','--name-only','--diff-filter=AM']).split('\n').filter(risky))];
const privateMaterial=[];
for(const path of tracked.filter(path=>!path.includes('node_modules/')&&!path.endsWith('.env.example'))){
 try {
  if((await stat(new URL(path,root))).size>2*1024*1024)continue;
  const source=await readFile(new URL(path,root),'utf8');
  if(/-----BEGIN (?:PGP PRIVATE KEY BLOCK|(?:RSA |EC |OPENSSH )?PRIVATE KEY)-----\s+[A-Za-z0-9+/=\r\n]{80,}/.test(source))privateMaterial.push(path);
 }catch(error){if(error.code!=='ENOENT')throw error;}
}
let legacy=null;
try {legacy=JSON.parse(await readFile(new URL('.local/legacy-migration-plan.json',root)));}catch{}
const report={checkedAt:new Date().toISOString(),trackedSensitivePaths:tracked.filter(risky),privateKeyMaterialPaths:privateMaterial,
 historicalSensitivePaths:historical,legacyInvoiceFiles:legacy?.legacyInvoiceFiles ?? null,
 releaseBlockers:[...(historical.length?['historical_credentials_require_owner_audit_and_rotation_verification']:[]),
  ...(tracked.some(risky)||privateMaterial.length?['sensitive_material_in_tracked_files']:[]),
  ...(legacy?.legacyInvoiceFiles?['legacy_invoice_reconciliation_required']:[]),
  'cloud_tls_waf_alerts_and_secret_rotation_not_verified_from_local_environment']};
await mkdir(new URL('.local/',root),{recursive:true,mode:0o700});
await writeFile(new URL('.local/security-preflight.json',root),JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify(report,null,2));
if(report.trackedSensitivePaths.length||report.privateKeyMaterialPaths.length)process.exitCode=1;
