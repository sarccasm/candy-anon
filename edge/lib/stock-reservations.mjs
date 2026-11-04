import {validToken} from './encrypted-fulfillment.mjs';

export function availableStock(stock) {
  const reserved=stock.reserved ?? 0;
  if(!Number.isSafeInteger(stock.quantity)||stock.quantity<0||!Number.isSafeInteger(reserved)||reserved<0||reserved>stock.quantity)
    throw Error('invalid_stock');
  return stock.quantity-reserved;
}
export async function reservationActions(store,items,{release=false}={}) {
  const entries=Object.entries(items || {});
  if(!entries.length||entries.length>50||entries.some(([sku,qty])=>!(/^[a-zA-Z0-9_-]{1,64}$/.test(sku))||!Number.isSafeInteger(qty)||qty<1||qty>100))
    throw Error('invalid_items');
  const actions=[];
  for(const [sku,qty] of entries){
    const stock=await store.client.getEntity('invoices','stock:'+sku);
    const available=availableStock(stock),reserved=stock.reserved ?? 0;
    if(release?reserved<qty:available<qty)throw Error(release?'invalid_reservation':'out_of_stock');
    const {etag,timestamp,...fields}=stock;
    actions.push(['update',{...fields,reserved:reserved+(release?-qty:qty)},'Replace',{etag}]);
  }
  return actions;
}
export async function releaseUnpaidReservation(store,token,observations,now=Date.now()) {
  if(!validToken(token)||!Array.isArray(observations)||observations.length!==2||
    observations.some(value=>!value||!['PENDING','EXPIRED'].includes(value.status)||value.receivedSats!==0||value.eligibleSats!==0))throw Error('unpaid_not_verified');
  const invoice=await store.read(token);
  if(!invoice||invoice.committed===true)throw Error('reservation_not_releasable');
  if(invoice.reservation?.status==='RELEASED')return {alreadyReleased:true};
  if(invoice.reservation?.status!=='ACTIVE'||!Number.isFinite(Date.parse(invoice.reservation.expiresAt))||now<=Date.parse(invoice.reservation.expiresAt))
    throw Error('reservation_not_expired');
  const actions=await reservationActions(store,invoice.items,{release:true});
  const {_etag,_version,...clean}=invoice;
  clean.reservation={...invoice.reservation,status:'RELEASED',releasedAt:new Date(now).toISOString()};
  clean.paymentStatus='EXPIRED';
  actions.push(['update',{partitionKey:'invoices',rowKey:token,payload:JSON.stringify(clean),version:_version+1},'Replace',{etag:_etag}]);
  await store.client.submitTransaction(actions);
  return {alreadyReleased:false};
}
