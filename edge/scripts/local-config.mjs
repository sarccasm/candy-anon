export const root=new URL('../../',import.meta.url);
// Standard public Azurite development key, never a cloud account credential.
export const connection='DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:11000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:11001/devstoreaccount1;TableEndpoint=http://127.0.0.1:11002/devstoreaccount1';
export async function rpc(method,params=[],wallet) {
 const response=await fetch('http://127.0.0.1:19443'+(wallet?'/wallet/'+encodeURIComponent(wallet):''),{
  method:'POST',headers:{authorization:'Basic '+Buffer.from('regtest:local-regtest-only').toString('base64'),
   'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
 const result=await response.json();if(result.error)throw Error('regtest_rpc:'+result.error.message);return result.result;
}
