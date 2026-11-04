import https from 'node:https';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {existsSync,openSync,closeSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {root,rpc,connection} from '../edge/scripts/local-config.mjs';
const require=createRequire(new URL('../edge/package.json',import.meta.url));
const {TableClient}=require('@azure/data-tables');
const {BlobServiceClient}=require('@azure/storage-blob');
const directory=new URL('.local/',root);
await mkdir(directory,{recursive:true,mode:0o700});
const processes=new Map();let browser,localApiKey;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function command(binary,args){
 await new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{cwd:fileURLToPath(root),stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(binary+'_failed:'+code)));
 });
}
function start(mode){
 const log=openSync(new URL(mode+'.log',directory),'a',0o600);
 const child=spawn(process.execPath,['scripts/local-run.mjs',mode],{cwd:fileURLToPath(root),detached:true,stdio:['ignore',log,log]});
 closeSync(log);processes.set(mode,child);return child;
}
async function stop(mode){
 const child=processes.get(mode);if(!child)return;
 try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(3000)]);
 try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
 processes.delete(mode);
}
async function until(check,label,timeout=90000){
 const end=Date.now()+timeout;
 while(Date.now()<end){try{const result=await check();if(result)return result;}catch{}await pause(500);}
 throw Error('timeout:'+label);
}
async function json(url,options={}){
 if(!url.startsWith('https://localhost:7071')){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});return {status:response.status,body:await response.json()};
 }
 const ca=await readFile(new URL('localhost.crt',directory));
 return new Promise((resolve,reject)=>{
  const request=https.request(url,{method:options.method || 'GET',headers:{...options.headers,...(options.body?{'content-length':Buffer.byteLength(options.body)}:{}),...(!options.omitLocalKey?{'x-local-api-key':localApiKey}:{})},ca},response=>{
   const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{
    try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(error){reject(error);}
   });
  });
  request.on('error',reject);request.setTimeout(20000,()=>request.destroy(Error('local_api_timeout')));
  if(options.body)request.write(options.body);request.end();
 });
}
async function launch(){
 const chrome=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 return chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
}
let shuttingDown=false;
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.once(signal,async()=>{
 if(shuttingDown)return;shuttingDown=true;
 await browser?.close();for(const mode of [...processes.keys()].reverse())await stop(mode);
 process.exit(code);
});
const report={environment:'local-regtest-azurite',checks:[],providerIndependence:'not tested: both local HTTPS adapters use the same regtest node'};
try {
 report.passed=false;report.startedAt=new Date().toISOString();
 await writeFile(new URL('e2e-report.json',directory),JSON.stringify(report,null,2),{mode:0o600});
 // Do not terminate somebody else's local server. This runner owns only its child groups.
 for(const port of [7071,5173,19101,19102]){
  const occupied=await new Promise(resolve=>{
   const socket=net.createConnection({host:'127.0.0.1',port});
   const finish=value=>{socket.destroy();resolve(value);};
   socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(1000,()=>finish(false));
  });
  if(occupied)throw Error('port_already_in_use:'+port);
 }
 console.log('Starting isolated local storage and regtest services.');
 await command('docker',['compose','-p','candy-anon-local','-f','compose.local.yml','up','-d']);
 await until(async()=>{const chain=await rpc('getblockchaininfo');return chain.chain==='regtest';},'regtest_ready',60000);
 await command(process.execPath,['edge/scripts/setup-local.mjs']);
 const settings=JSON.parse(await readFile(new URL('settings.json',directory)));
 localApiKey=settings.LOCAL_API_KEY;
 const table=TableClient.fromConnectionString(connection,settings.AZURE_INVOICES_TABLE,{allowInsecureConnection:true});
 const container=BlobServiceClient.fromConnectionString(connection).getContainerClient(settings.ENCRYPTED_ESCROW_CONTAINER);
 start('bridge');start('edge');start('frontend');
 await until(async()=>{const result=await json('https://localhost:7071/api/products');return result.status===200;},'functions_ready');
 await until(async()=>{const result=await fetch('http://127.0.0.1:5173');return result.ok;},'frontend_ready',30000);
 assert.equal((await json('https://localhost:7071/api/products',{omitLocalKey:true})).status,403);
 const hiddenSettings=await fetch('http://127.0.0.1:5173/@fs'+fileURLToPath(new URL('settings.json',directory)));
 assert.ok([403,404].includes(hiddenSettings.status));
 const hiddenBody=await hiddenSettings.text();assert.equal(hiddenBody.includes(settings.ADMIN_KEY),false);assert.equal(hiddenBody.includes(settings.LOCAL_API_KEY),false);
 console.log('HTTPS Functions host ready; unauthenticated API and private-file access are denied. Testing checkout in a real browser.');
 const before=(await table.getEntity('invoices','stock:local-candy')).quantity;
 assert.ok(before>0,'local stock exhausted; use a fresh local environment');
 browser=await launch();
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:5173');
 await page.locator('#btnBrowse').click();
 await page.locator('[data-id="local-candy"].addBtn').click();
 await page.locator('#btnOpenCart').click();await page.locator('#btnDrawerCheckout').click();
 const details={name:'LOCAL E2E RECIPIENT',address:'123 REGTEST ONLY STREET',phone:'5550001234'};
 await page.locator('#fldName').fill(details.name);await page.locator('#fldAddr').fill(details.address);await page.locator('#fldPhone').fill(details.phone);
 const [response]=await Promise.all([
  page.waitForResponse(response=>response.url().endsWith('/api/pay/create')&&response.request().method()==='POST'),
  page.locator('#btnContinuePay').click()
 ]);assert.equal(response.status(),200,'invoice creation failed');
 const invoice=await response.json();
 await page.locator('#payBox:not(.hidden)').waitFor({timeout:30000});
 assert.match(invoice.address,/^bcrt1/);assert.ok(Number.isSafeInteger(invoice.amountSats)&&invoice.amountSats>0);
 assert.ok((await rpc('getaddressinfo',[invoice.address],'watch')).ismine,'address must belong to imported watch-only descriptor');
 const ciphertext=await container.getBlockBlobClient(invoice.token+'.asc').downloadToBuffer();
 assert.match(ciphertext.toString(),/BEGIN PGP MESSAGE/);
 for(const value of Object.values(details))assert.equal(ciphertext.includes(Buffer.from(value)),false);
 await page.close();await browser.close();browser=null;
 report.checks.push('browser checkout, pinned PGP encryption, durable private Blob escrow, tab closed');
 console.log('Browser closed. Restarting Functions before funding the invoice.');
 await stop('edge');start('edge');
 await until(async()=>{const result=await json('https://localhost:7071/api/products');return result.status===200;},'functions_restart');
 assert.deepEqual(await container.getBlockBlobClient(invoice.token+'.asc').downloadToBuffer(),ciphertext);
 await rpc('sendtoaddress',[invoice.address,Number((invoice.amountSats/1e8).toFixed(8))],'miner');
 assert.equal(JSON.parse((await table.getEntity('invoices',invoice.token)).payload).committed,false);
 assert.equal((await table.getEntity('invoices','stock:local-candy')).quantity,before);
 const miningAddress=await rpc('getnewaddress',[],'miner');
 const blocks=await rpc('generatetoaddress',[2,miningAddress],'miner');
 console.log('Regtest payment mined. Waiting for the real minute timer; no browser or payment-status requests.');
 const committed=await until(async()=>{
  const row=JSON.parse((await table.getEntity('invoices',invoice.token)).payload);return row.committed===true?row:null;
 },'background_settlement',100000);
 assert.equal(committed.fulfillment.status,'PENDING');
 assert.equal((await table.getEntity('invoices','stock:local-candy')).quantity,before-1);
 report.checks.push('real regtest transaction and confirmations, process restart, browser-independent minute timer settlement');
 const headers={'x-admin-key':settings.ADMIN_KEY};
 assert.equal((await json('https://localhost:7071/api/dash/orders')).status,401);
 const reference=createHash('sha256').update('admin-order:'+invoice.token).digest('hex').slice(0,24);
 let cursor,listed;
 do{
  const result=await json('https://localhost:7071/api/dash/orders'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers});
  assert.equal(result.status,200);assert.equal(JSON.stringify(result.body).includes(invoice.token),false);
  listed=result.body.orders.find(order=>order.reference===reference);cursor=result.body.nextCursor;
 }while(!listed&&cursor);
 assert.equal(listed.fulfillmentStatus,'PENDING');
 browser=await launch();const admin=await browser.newPage();
 admin.on('dialog',dialog=>dialog.accept(settings.ADMIN_KEY));
 await admin.goto('http://127.0.0.1:5173/admin.html');
 await admin.locator('[data-screen="orders"]').click();
 // A reused local environment may require more than one raw Table page.
 await until(async()=>{
  if((await admin.locator('[data-order-rows]').textContent()).includes(reference))return true;
  const more=admin.locator('[data-order-more]');if(await more.isVisible())await more.click();return false;
 },'admin_order_visible',30000);
 await admin.locator('[data-screen="dashboard"]').click();
 await until(async()=> (await admin.locator('[data-checkout-state]').textContent()).includes('Нові оплати:'),'checkout_controls',10000);
 const [stopped]=await Promise.all([
  admin.waitForResponse(response=>response.url().endsWith('/api/dash/checkout')&&response.request().method()==='POST'),
  admin.locator('[data-checkout-stop]').click()
 ]);assert.equal(stopped.status(),200);
 await until(async()=> (await admin.locator('[data-checkout-state]').textContent()).includes('зупинено'),'checkout_stopped',10000);
 const refused=await json('https://localhost:7071/api/pay/create',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({lines:[{sku:'local-candy',qty:1}],quotedTotalCents:350})});
 assert.equal(refused.status,409);assert.equal(refused.body.error,'checkout_disabled');
 const [enabled]=await Promise.all([
  admin.waitForResponse(response=>response.url().endsWith('/api/dash/checkout')&&response.request().method()==='POST'),
  admin.locator('[data-checkout-start]').click()
 ]);assert.equal(enabled.status(),200);
 await until(async()=> (await admin.locator('[data-checkout-state]').textContent()).includes('увімкнено'),'checkout_enabled',10000);
 report.checks.push('real admin checkout stop blocks new invoices and can resume without interrupting existing orders');
 await browser.close();browser=null;
 for(let attempt=0;attempt<2;attempt++){
  const result=await json('https://localhost:7071/api/create-shipment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:invoice.token})});
  assert.equal(result.status,200,result.body?.error || 'shipment retry failed');
 }
 assert.equal((await table.getEntity('invoices','stock:local-candy')).quantity,before-1);
 report.checks.push('authenticated admin browser view and idempotent shipment retries without double stock deduction');
 await rpc('invalidateblock',[blocks[0]]);
 const reorg=await json('https://localhost:7071/api/pay/status?token='+invoice.token);
 assert.equal(reorg.body.status,'REORG_REVIEW');
 assert.equal(JSON.parse((await table.getEntity('invoices',invoice.token)).payload).fulfillment.status,'ON_HOLD');
 const recoveryBlocks=await rpc('generatetoaddress',[2,miningAddress],'miner');
 const recovered=await json('https://localhost:7071/api/pay/status?token='+invoice.token);
 assert.equal(recovered.body.paid,true);assert.equal((await table.getEntity('invoices','stock:local-candy')).quantity,before-1);
 report.checks.push('real block invalidation holds fulfillment; fresh confirmations recover without another deduction');
 browser=await launch();const operator=await browser.newPage();operator.on('dialog',dialog=>dialog.accept(settings.ADMIN_KEY));
 await operator.goto('http://127.0.0.1:5173/admin.html');await operator.locator('[data-screen="orders"]').click();
 await operator.locator('[data-order-token]').fill(invoice.token);await operator.locator('[data-order-lookup]').click();
 await until(async()=> (await operator.locator('[data-order-reference]').textContent())===reference,'support_lookup',15000);
 assert.equal(await operator.locator('[data-order-token]').inputValue(),'');
 async function adminAction(selector){
  const [result]=await Promise.all([
   operator.waitForResponse(response=>response.url().endsWith('/action')&&response.request().method()==='POST'),
   operator.locator(selector).click()
  ]);assert.equal(result.status(),200,'manual action failed');return result;
 }
 await operator.locator('[data-review-category]').selectOption('REFUND_REQUIRED');await adminAction('[data-review-open]');
 await until(async()=> (await operator.locator('[data-order-review-status]').textContent()).includes('REFUND_REQUIRED'),'review_open',10000);
 assert.equal(await operator.locator('[data-order-prepare]').isDisabled(),true);
 await adminAction('[data-review-close]');
 await until(async()=> await operator.locator('[data-order-prepare]').isEnabled(),'review_reverified',15000);
 const [download]=await Promise.all([operator.waitForEvent('download'),adminAction('[data-order-prepare]')]);assert.equal(download.suggestedFilename(),reference+'.asc');
 assert.deepEqual(await readFile(await download.path()),ciphertext);
 await until(async()=> (await operator.locator('[data-order-detail-status]').textContent()).includes('HANDOFF_READY'),'handoff_ready',10000);
 await operator.locator('[data-order-receipt]').fill('LOCAL-TEST-RECEIPT');await operator.locator('[data-order-attest]').check();
 await until(async()=> await operator.locator('[data-order-ack]').isEnabled(),'handoff_ack_enabled',10000);
 const ackResponse=await adminAction('[data-order-ack]');const ackBody=ackResponse.request().postDataJSON();
 await until(async()=> (await operator.locator('[data-order-detail-status]').textContent()).includes('FULFILLED'),'handoff_acknowledged',10000);
 const repeated=await json('https://localhost:7071/api/dash/orders/'+reference+'/action',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(ackBody)});
 assert.equal(repeated.status,200);assert.equal(repeated.body.duplicate,true);
 const completed=JSON.parse((await table.getEntity('invoices',invoice.token)).payload);
 assert.equal(completed.fulfillment.status,'FULFILLED');assert.equal(completed.fulfillment.receiptHash.length,64);
 assert.equal(JSON.stringify(completed).includes('LOCAL-TEST-RECEIPT'),false);
 assert.equal(completed.reservation.status,'CONSUMED');
 assert.equal((await table.getEntity('invoices','stock:local-candy')).reserved,0);
 await browser.close();browser=null;
 await rpc('invalidateblock',[recoveryBlocks[0]]);
 await json('https://localhost:7071/api/pay/status?token='+invoice.token);
 const shippedReview=JSON.parse((await table.getEntity('invoices',invoice.token)).payload);
 assert.equal(shippedReview.fulfillment.status,'FULFILLED');assert.equal(shippedReview.fulfillment.paymentHold,true);
 await rpc('generatetoaddress',[2,miningAddress],'miner');await json('https://localhost:7071/api/pay/status?token='+invoice.token);
 assert.equal((await table.getEntity('invoices','stock:local-candy')).quantity,before-1);
 report.checks.push('support token lookup, audited review, encrypted manual download, explicit acknowledgement and retry safety in the real admin browser');
 report.checks.push('acknowledged handoff survives later reorgs without resetting the shipment or inventory');
 for await(const row of table.listEntities({queryOptions:{filter:"PartitionKey eq 'invoices'"}})){
  for(const value of Object.values(details))assert.equal(JSON.stringify(row).includes(value),false);
 }
 for(const name of ['edge.log','bridge.log','frontend.log']){
  const log=await readFile(new URL(name,directory),'utf8').catch(()=>'');
  for(const value of Object.values(details))assert.equal(log.includes(value),false);
 }
 report.checks.push('no synthetic delivery plaintext in invoice Table, encrypted Blob, or app logs');
 report.passed=true;report.completedAt=new Date().toISOString();
 await writeFile(new URL('e2e-report.json',directory),JSON.stringify(report,null,2),{mode:0o600});
 console.log('PASS: local browser -> PGP escrow -> real regtest payment -> background settlement -> admin task; restart and reorg verified.');
} catch(error) {
 report.passed=false;report.failedAt=new Date().toISOString();
 await writeFile(new URL('e2e-report.json',directory),JSON.stringify(report,null,2),{mode:0o600});
 console.error('Local end-to-end check failed:',error.message);
 process.exitCode=1;
} finally {
 await browser?.close();for(const mode of [...processes.keys()].reverse())await stop(mode);
}
