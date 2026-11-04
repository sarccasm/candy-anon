import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {TableClient} from '@azure/data-tables';
import {BlobServiceClient} from '@azure/storage-blob';
import BIP32Factory from 'bip32';
import * as ecc from 'tiny-secp256k1';
import bs58check from 'bs58check';
import {validateProducts} from '../lib/catalog.mjs';
import {planInventoryMigration} from '../lib/inventory-migration.mjs';
import {connection,root,rpc} from './local-config.mjs';

const directory=new URL('.local/',root),settingsFile=new URL('settings.json',directory);
await mkdir(directory,{recursive:true,mode:0o700});
const state=JSON.parse(await readFile(new URL('fixtures/local-catalog.json',root)));
const inventory=JSON.parse(await readFile(new URL('fixtures/local-inventory.json',root)));
const products=validateProducts(state.products),stock=planInventoryMigration(inventory);
if(products.some(product=>!stock.some(row=>row.rowKey==='stock:'+product.id)))throw Error('missing_stock');
if(process.argv.includes('--plan-only')){
 console.log(JSON.stringify({dryRun:true,products:products.length,stockRows:stock.length}));
 process.exit(0);
}
const chain=await rpc('getblockchaininfo');if(chain.chain!=='regtest')throw Error('regtest_required');
let settings;
try {settings=JSON.parse(await readFile(settingsFile));} catch(error){if(error.code!=='ENOENT')throw error;}
if(settings && (settings.NETWORK!=='regtest'||settings.AZURE_STORAGE_CONNECTION_STRING!==connection))throw Error('unexpected_local_settings');
if(!settings){
 const bip32=BIP32Factory(ecc);
 const testnet={messagePrefix:'\u0018Bitcoin Signed Message:\n',bech32:'bcrt',bip32:{public:0x043587cf,private:0x04358394},pubKeyHash:0x6f,scriptHash:0xc4,wif:0xef};
 const tpub=bip32.fromSeed(randomBytes(32),testnet).neutered().toBase58();
 const bytes=Buffer.from(bs58check.decode(tpub));bytes.writeUInt32BE(0x045f1cf6);
 settings={FUNCTIONS_WORKER_RUNTIME:'node',AzureWebJobsStorage:connection,AZURE_STORAGE_CONNECTION_STRING:connection,
  AZURE_INVOICES_TABLE:'CandyLocalInvoices',ENCRYPTED_ESCROW_CONTAINER:'candy-local-escrow',
  ADMIN_KEY:randomBytes(32).toString('hex'),NETWORK:'regtest',XPUB:bs58check.encode(bytes),LOCAL_TPUB:tpub,
  USD_PER_BTC:'70000',MIN_SATS:'5000',MIN_CONFIRMATIONS:'2',
  ALLOW_ORIGIN:'http://127.0.0.1:5173',ALLOWED_ORIGIN:'http://127.0.0.1:5173',
  BLOCKSTREAM_API:'https://localhost:19101/api',ESPLORA_FALLBACK:'https://localhost:19102/api',
  PAYMENT_SCAN_BATCH_SIZE:'20',ENABLE_ESCROW_PURGE:'false',
  'AzureWebJobs.EscrowCleanup.Disabled':'true',
  DATA_DIR:fileURLToPath(new URL('data/',directory)),NODE_EXTRA_CA_CERTS:fileURLToPath(new URL('localhost.crt',directory))};
 await writeFile(settingsFile,JSON.stringify(settings,null,2),{mode:0o600});
}
settings.FUNCTIONS_REQUEST_BODY_SIZE_LIMIT='65536';
settings.REQUIRE_LOCAL_API_KEY='true';settings.LOCAL_API_KEY ||= randomBytes(32).toString('hex');
await writeFile(settingsFile,JSON.stringify(settings,null,2),{mode:0o600});
const table=TableClient.fromConnectionString(connection,settings.AZURE_INVOICES_TABLE,{allowInsecureConnection:true});
try {await table.createTable();} catch(error){if(error.statusCode!==409)throw error;}
const container=BlobServiceClient.fromConnectionString(connection).getContainerClient(settings.ENCRYPTED_ESCROW_CONTAINER);
await container.createIfNotExists();
const permissions=await container.getAccessPolicy();if(permissions.blobPublicAccess)throw Error('public_escrow_not_allowed');
const actions=[];
try {
 const existing=await table.getEntity('invoices','catalog:v1');
 if(JSON.stringify(validateProducts(JSON.parse(existing.payload)))!==JSON.stringify(products))throw Error('existing_catalog_requires_review');
} catch(error){if(error.statusCode!==404)throw error;actions.push(['create',{partitionKey:'invoices',rowKey:'catalog:v1',payload:JSON.stringify(products)}]);}
for(const row of stock){
 try {const existing=await table.getEntity('invoices',row.rowKey);if(!Number.isSafeInteger(existing.quantity)||existing.quantity<0)throw Error('invalid_existing_stock');}
 catch(error){if(error.statusCode!==404)throw error;actions.push(['create',row]);}
}
const policy={partitionKey:'invoices',rowKey:'checkout:policy',enabled:true,revision:0,
 usdPerBtc:Number(settings.USD_PER_BTC),quoteUpdatedAt:new Date().toISOString(),quoteMaxAgeSeconds:900,maxInvoicesPerMinute:30};
try {
 const current=await table.getEntity('invoices',policy.rowKey);
 const {etag,timestamp,...fields}=current;
 // Refresh the explicitly synthetic local quote, never re-enable a stopped checkout.
 await table.updateEntity({...fields,usdPerBtc:policy.usdPerBtc,quoteUpdatedAt:policy.quoteUpdatedAt,revision:(current.revision || 0)+1},'Replace',{etag});
}catch(error){if(error.statusCode!==404)throw error;actions.push(['create',policy]);}
if(actions.length)await table.submitTransaction(actions);
const wallets=await rpc('listwalletdir');
for(const name of ['miner','watch']){
 if(!(await rpc('listwallets')).includes(name)){
  if(wallets.wallets.some(wallet=>wallet.name===name))await rpc('loadwallet',[name]);
  else await rpc('createwallet',[name,name==='watch',name==='watch']);
 }
}
const descriptor=(await rpc('getdescriptorinfo',[`wpkh(${settings.LOCAL_TPUB}/1/*)`])).descriptor;
const walletInfo=await rpc('getwalletinfo',[],'watch');
if(walletInfo.private_keys_enabled!==false)throw Error('watch_only_wallet_required');
const existingDescriptor=(await rpc('listdescriptors',[],'watch')).descriptors.find(value=>value.desc===descriptor);
// Core extends the watched range after receiving funds. Never narrow it on rerun.
if(!existingDescriptor || existingDescriptor.range?.[1]<1000){
 const imported=await rpc('importdescriptors',[[{desc:descriptor,timestamp:0,
  range:[0,Math.max(1000,existingDescriptor?.range?.[1] || 0)],active:false}]],'watch');
 if(!imported[0]?.success)throw Error('watch_descriptor_import_failed');
}
if(chain.blocks<101){const miningAddress=await rpc('getnewaddress',[],'miner');await rpc('generatetoaddress',[101-chain.blocks,miningAddress],'miner');}
const expected=await rpc('deriveaddresses',[descriptor,[0,0]]);
process.env.NETWORK='regtest';
const {deriveAddress}=await import('../lib/derive-btc.mjs');
if(deriveAddress(settings.XPUB,0,1)!==expected[0])throw Error('wallet_branch_mismatch');
let renewCertificate=false;
try {
 await readFile(new URL('localhost.crt',directory));
 renewCertificate=spawnSync('openssl',['x509','-checkend','86400','-noout','-in',settings.NODE_EXTRA_CA_CERTS],{stdio:'ignore'}).status!==0;
}catch(error){if(error.code!=='ENOENT')throw error;renewCertificate=true;}
if(renewCertificate){
 const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','30',
  '-keyout',fileURLToPath(new URL('localhost.key',directory)),'-out',settings.NODE_EXTRA_CA_CERTS,
  '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 if(result.status!==0)throw Error('local_certificate_generation_failed');
 await chmod(new URL('localhost.key',directory),0o600);
}
// Local Functions HTTPS uses the same isolated development CA; never trust it system-wide.
const tlsPasswordFile=new URL('functions-tls-password',directory),pfxFile=new URL('functions.pfx',directory);
let tlsPassword;try{tlsPassword=await readFile(tlsPasswordFile,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;tlsPassword=randomBytes(24).toString('hex');await writeFile(tlsPasswordFile,tlsPassword,{mode:0o600});}
const exported=spawnSync('openssl',['pkcs12','-export','-out',fileURLToPath(pfxFile),
 '-inkey',fileURLToPath(new URL('localhost.key',directory)),'-in',settings.NODE_EXTRA_CA_CERTS,
 '-passout','file:'+fileURLToPath(tlsPasswordFile)],{stdio:'ignore'});
if(exported.status!==0)throw Error('local_https_certificate_export_failed');await chmod(pfxFile,0o600);
settings.LOCAL_API_TARGET='https://localhost:7071';
settings.LOCAL_FUNCTIONS_CERT=fileURLToPath(pfxFile);settings.LOCAL_FUNCTIONS_CERT_PASSWORD_FILE=fileURLToPath(tlsPasswordFile);
await writeFile(settingsFile,JSON.stringify(settings,null,2),{mode:0o600});
await mkdir(settings.DATA_DIR,{recursive:true,mode:0o700});
await writeFile(new URL('migration-plan.json',directory),JSON.stringify({environment:'local-regtest',products:products.length,
 stockRows:stock.length,createdRows:actions.length,walletBranchVerified:true,escrowPrivate:true},null,2),{mode:0o600});
console.log('Local storage configured; create-only catalog/stock migration complete; private escrow and watch-only branch verified.');
