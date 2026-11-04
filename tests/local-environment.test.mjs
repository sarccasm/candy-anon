import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {isLoopbackAzurite,localStorageOptions} from '../edge/lib/local-storage.mjs';
import {connection} from '../edge/scripts/local-config.mjs';

test('HTTP storage exception is limited to the public Azurite account on loopback',()=>{
 assert.equal(isLoopbackAzurite(connection),true);
 assert.deepEqual(localStorageOptions(connection),{allowInsecureConnection:true});
 for(const value of [connection.replaceAll('127.0.0.1','example.com'),
  connection.replace('AccountName=devstoreaccount1','AccountName=cloudaccount'),
  connection.replace('AccountKey=Eby8','AccountKey=invalid'),
  connection.replace('http://127.0.0.1:11000','http://user:secret@127.0.0.1:11000'),'',undefined]){
  assert.equal(isLoopbackAzurite(value),false);assert.deepEqual(localStorageOptions(value),{});
 }
});
test('every Azure Function explicitly identifies the ESM script and default export',async()=>{
 const dirs=await readdir(new URL('../edge/',import.meta.url),{withFileTypes:true});
 let functions=0;
 for(const dir of dirs.filter(dir=>dir.isDirectory())){
  let config;
  try{config=JSON.parse(await readFile(new URL('../edge/'+dir.name+'/function.json',import.meta.url)));}
  catch(error){if(error.code==='ENOENT')continue;throw error;}
  assert.equal(config.scriptFile,'index.mjs',dir.name);assert.equal(config.entryPoint,'default',dir.name);
  if(config.bindings.some(binding=>binding.type==='httpTrigger')){
   const {default:handler}=await import('../edge/'+dir.name+'/index.mjs');
   const context={};await handler(context,{method:'OPTIONS'});
   assert.equal(context.res.status,204,dir.name);
  }
  functions++;
 }
 assert.ok(functions>=12);
});
test('regtest derives bcrt addresses and unsupported networks fail at startup',()=>{
 const script=`import {createRequire} from 'node:module';
 const require=createRequire(new URL('./edge/package.json',import.meta.url));
 const {BIP32Factory}=require('bip32'),ecc=require('tiny-secp256k1'),bs58=require('bs58check').default;
 const network=require('bitcoinjs-lib').networks.regtest;
 const root=BIP32Factory(ecc).fromSeed(Buffer.alloc(32,1),network);
 const bytes=Buffer.from(bs58.decode(root.neutered().toBase58()));bytes.writeUInt32BE(0x045f1cf6);
 const {deriveAddress}=await import('./edge/lib/derive-btc.mjs');
 console.log(deriveAddress(bs58.encode(bytes),0,1));`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,NETWORK:'regtest'}});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/^bcrt1/);
 const unknown=spawnSync(process.execPath,['--input-type=module','-e',"await import('./edge/lib/derive-btc.mjs')"],
  {encoding:'utf8',env:{...process.env,NETWORK:'unknown'}});
 assert.notEqual(unknown.status,0);assert.match(unknown.stderr,/invalid_bitcoin_network/);
 const wrong=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,NETWORK:'mainnet'}});
 assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/xpub_network_mismatch/);
});
