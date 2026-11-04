import {createHash} from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import {validToken} from './encrypted-fulfillment.mjs';
import {observeBitcoinInvoice} from './esplora-watcher.mjs';

export const legacyProviders=['https://blockstream.info/api','https://mempool.space/api'];
export const legacyReference=token=>createHash('sha256').update('admin-order:'+token).digest('hex').slice(0,24);
export const legacyInvoiceDigest=invoice=>createHash('sha256').update(JSON.stringify({token:invoice.token,address:invoice.address,amountSats:invoice.amountSats,createdAt:invoice.createdAt,items:invoice.items,committed:invoice.committed})).digest('hex');
export function validLegacyInvoice(invoice) {
 if(!validToken(invoice?.token)||typeof invoice.address!=='string'||!Number.isSafeInteger(invoice.amountSats)||invoice.amountSats<=0)return false;
 try {bitcoin.address.toOutputScript(invoice.address,bitcoin.networks.bitcoin);return true;}catch{return false;}
}
function validObservation(value) {
 const fields=['receivedSats','confirmedSats','unconfirmedSats','eligibleSats','confirmations'];
 return value&&['PENDING','PARTIALLY_PAID','CONFIRMING','PAID'].includes(value.status)&&
  fields.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)&&
  value.confirmedSats+value.unconfirmedSats===value.receivedSats&&value.eligibleSats<=value.confirmedSats;
}
export async function reconcileLegacyInvoice({invoice,network=false,observe=observeBitcoinInvoice,historicalInvoiceCount=1}) {
 const reference=validToken(invoice?.token)?legacyReference(invoice.token):null;
 const base={reference,sourceDigest:reference?legacyInvoiceDigest(invoice):null,expectedSats:Number.isSafeInteger(invoice?.amountSats)?invoice.amountSats:null,
  committedLocally:invoice?.committed===true,historicalInvoiceCount,mutated:false};
 if(!validLegacyInvoice(invoice))return {...base,status:'INVALID_INVOICE_OR_NETWORK',providers:[]};
 if(!network)return {...base,status:'NOT_CHECKED_ON_CHAIN',providers:[]};
 const providers=[];
 for(const source of legacyProviders){
  let observation;
  for(let attempt=0;attempt<2&&!observation;attempt++){
   try {
    const result=await observe({address:invoice.address,expectedSats:invoice.amountSats,requiredConfirmations:2,
     expired:false,baseUrl:source,signal:AbortSignal.timeout(30000)});
    if(validObservation(result))observation=result;
   }catch{/* Never print provider errors which may contain an address-bearing URL. */}
  }
  providers.push(observation?{source,verified:true,status:observation.status,receivedSats:observation.receivedSats,
   confirmedSats:observation.confirmedSats,unconfirmedSats:observation.unconfirmedSats,
   eligibleSats:observation.eligibleSats,confirmations:observation.confirmations}:{source,verified:false,error:'verification_unavailable'});
 }
 const complete=providers.every(provider=>provider.verified);
 const agree=complete&&['receivedSats','confirmedSats','unconfirmedSats','eligibleSats'].every(key=>providers[0][key]===providers[1][key]);
 let status=!complete?'VERIFICATION_UNAVAILABLE':!agree?'PROVIDER_DISAGREEMENT':
  providers[0].receivedSats===0?'NO_FUNDS_OBSERVED':historicalInvoiceCount>1?'ADDRESS_REUSE_REQUIRES_REVIEW':
  providers[0].eligibleSats>=invoice.amountSats?'FUNDED_LEGACY_REQUIRES_REVIEW':'PARTIAL_OR_UNCONFIRMED_REQUIRES_REVIEW';
 return {...base,status,providers};
}
