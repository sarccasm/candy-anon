import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {historicalBlobs} from './lib/git-history.mjs';
import {classifyCredential,rotationAction} from './lib/credential-classification.mjs';
const root=new URL('../',import.meta.url);
const require=createRequire(new URL('../edge/package.json',import.meta.url));
const {parse}=require('dotenv');
const paths=['edge/.env','edge/local.settings.json','frontend/certs/localhost-key.pem','frontend/certs/localhost.pem'];
const entries=new Map();
function add(name,value,path){
 const classification=classifyCredential(name,value);
 if(!entries.has(name))entries.set(name,{name,classes:new Set(),versions:new Set(),paths:new Set()});
 const entry=entries.get(name);entry.classes.add(classification);entry.paths.add(path);
 entry.versions.add(createHash('sha256').update(String(value)).digest('hex'));
}
let blobs=0;
for(const {path,content} of historicalBlobs(paths,fileURLToPath(root))){
 blobs++;
 if(path.endsWith('-key.pem')){add('LOCAL_TLS_PRIVATE_KEY',content,path);continue;}
 if(path.endsWith('.pem'))continue;
 let settings;
 try {settings=path.endsWith('.json')?JSON.parse(content).Values:parse(content);}catch{continue;}
 for(const [name,value] of Object.entries(settings || {})){
  if(/KEY|SECRET|PASS|TOKEN|CONNECTION_STRING|XPUB|PGP_PRIVATE/i.test(name))add(name,value,path);
 }
}
let localAdminKeyReusesHistoricalValue=null;
try {
 const settings=JSON.parse(await readFile(new URL('.local/settings.json',root)));
 localAdminKeyReusesHistoricalValue=entries.get('ADMIN_KEY')?.versions.has(createHash('sha256').update(settings.ADMIN_KEY || '').digest('hex')) ?? false;
}catch{}
const report={checkedAt:new Date().toISOString(),historicalBlobs:blobs,valuesIncluded:false,cloudRotationVerified:false,
 localAdminKeyReusesHistoricalValue,entries:[...entries.values()].map(entry=>{
  const classifications=[...entry.classes];
  const important=['private_key_material','potentially_live_secret','weak_default'].find(value=>classifications.includes(value)) || classifications[0];
  return {name:entry.name,classifications,versionsSeen:entry.versions.size,sourcePaths:[...entry.paths],action:rotationAction(entry.name,important)};
 })};
await mkdir(new URL('.local/',root),{recursive:true,mode:0o700});
await writeFile(new URL('.local/credential-rotation-plan.json',root),JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify(report,null,2));
