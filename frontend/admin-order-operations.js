const errorText={not_found:"Рахунок не знайдено.",invalid_token:"Перевірте токен рахунку.",operation_conflict:'Дані змінилися. Оновіть замовлення й повторіть дію.',
 payment_requires_review:'Оплата зараз не пройшла перевірку. Передавання заблоковане.',review_open:'Спочатку завершіть розгляд проблеми.',
 handoff_already_prepared:'Передавання вже підготовлене. Оновіть замовлення.',handoff_not_ready:'Стан передавання змінився. Оновіть замовлення.',
 btc_quote_expired:'Спочатку оновіть курс BTC.',receipt_required:'Вкажіть номер підтвердження та поставте позначку передавання.',
 unauthorized:'Немає доступу. Перевірте ключ адміністратора.',lookup_limit_use_token:'Скористайтеся пошуком за токеном покупця.'};
const labels={prepare_handoff:'Підготовлено зашифровані дані',acknowledge_handoff:'Підтверджено ручне передавання',
 open_review:'Відкрито розгляд',close_review:'Закрито розгляд'};
export function mountAdminOperations({root,getAdminKey,onOrderChanged=()=>{}}) {
 let order=null,policy=null,busy=false,pending=null,lastAudit=[];
 const $=selector=>root.querySelector(selector);
 async function api(path,body){
  const response=await fetch('/api/dash/'+path,{method:body?'POST':'GET',cache:'no-store',
   headers:{'x-admin-key':getAdminKey(),...(body?{'content-type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw Error(result.error || 'operations_unavailable');return result;
 }
 const message=(error,text)=>{$('[data-operation-message]').textContent=error?(errorText[error.message] || 'Дію не виконано. Оновіть дані та спробуйте ще раз.'):text;};
 function renderOrder(result){
  if(result.audit)lastAudit=result.audit;
  order=result.order;const detail=$('[data-order-detail]');detail.hidden=false;
  $('[data-order-reference]').textContent=order.reference;
  $('[data-order-detail-status]').textContent=`Оплата: ${order.paymentStatus}. Передавання: ${order.fulfillmentStatus || 'не створено'}. Резерв: ${order.reservationStatus || 'старий рахунок'}.`;
  $('[data-order-review-status]').textContent=order.review?.state==='OPEN'?`Відкритий розгляд: ${order.review.category}`:'Відкритого розгляду немає';
  const ready=order.paymentStatus==='PAID'&&order.review?.state!=='OPEN'&&!order.refundRecordedExternally;
  $('[data-order-prepare]').disabled=busy||!ready||!['PENDING','HANDOFF_READY'].includes(order.fulfillmentStatus);
  $('[data-order-prepare]').textContent=order.fulfillmentStatus==='HANDOFF_READY'?'Завантажити шифротекст знову':'Підготувати й завантажити шифротекст';
  $('[data-order-ack]').disabled=busy||!ready||order.fulfillmentStatus!=='HANDOFF_READY'||!$('[data-order-attest]').checked;
  $('[data-review-close]').disabled=busy||order.review?.state!=='OPEN';
  $('[data-review-open]').disabled=busy;
  const audit=$('[data-order-audit]');audit.replaceChildren();
  for(const event of lastAudit){
   const row=document.createElement('li');row.textContent=`${new Date(event.at).toLocaleString('uk-UA')} · ${labels[event.action] || event.action} · ключ ${event.actor}${event.reasonCode?' · '+event.reasonCode:''}`;audit.appendChild(row);
  }
 }
 async function openOrder(reference){
  try {renderOrder(await api('orders/'+encodeURIComponent(reference)));message(null,'');}
  catch(error){message(error);}
 }
 async function action(name,extra={}){
  if(!order||busy)return;
  const fingerprint=JSON.stringify({reference:order.reference,action:name,...extra});
  const requestId=name==='prepare_handoff'&&order.downloadRequestId?order.downloadRequestId:
   pending?.fingerprint===fingerprint?pending.requestId:crypto.randomUUID();
  pending={fingerprint,requestId};busy=true;
  try {
   const result=await api('orders/'+order.reference+'/action',{action:name,requestId,version:order.operationsVersion,...extra});
   if(result.ciphertext){
    const url=URL.createObjectURL(new Blob([result.ciphertext],{type:'application/pgp-encrypted'}));
    const link=document.createElement('a');link.href=url;link.download=order.reference+'.asc';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }
   pending=null;await openOrder(order.reference);await onOrderChanged();
   if(name==='acknowledge_handoff'){$('[data-order-receipt]').value='';$('[data-order-attest]').checked=false;}
   message(null,result.ciphertext?'Завантажено зашифровані дані. Передайте їх довіреному отримувачу один раз і збережіть підтвердження.':'Дію збережено в журналі.');
  }catch(error){message(error);}
  finally{busy=false;if(order)renderOrder({order,audit:await api('orders/'+order.reference).then(result=>result.audit).catch(()=>[])});}
 }
 function setPolicy(value){
  policy=value;
  $('[data-checkout-state]').textContent=`Нові оплати: ${policy.enabled?'увімкнено':'зупинено'}. Курс: ${policy.usdPerBtc} USD/BTC (${policy.quoteFresh?'чинний':'потребує оновлення'}).`;
  $('[data-checkout-quote]').value=policy.usdPerBtc;
 }
 async function changePolicy(action,extra){
  if(!policy)return;
  try {
   const result=await api('checkout',{action,...extra,requestId:crypto.randomUUID(),version:policy.version});setPolicy(result.checkout);
   $('[data-checkout-message]').textContent='Налаштування збережено. Уже створені рахунки продовжують перевірятися.';
  }catch(error){$('[data-checkout-message]').textContent=errorText[error.message] || 'Не вдалося змінити налаштування. Оновіть сторінку.';}
 }
 $('[data-order-prepare]').addEventListener('click',()=>action('prepare_handoff'));
 $('[data-order-attest]').addEventListener('change',()=>{if(order)renderOrder({order});});
 $('[data-order-ack]').addEventListener('click',()=>action('acknowledge_handoff',{
  receiptReference:$('[data-order-receipt]').value.trim(),confirmed:$('[data-order-attest]').checked}));
 $('[data-review-open]').addEventListener('click',()=>action('open_review',{category:$('[data-review-category]').value}));
 $('[data-review-close]').addEventListener('click',()=>action('close_review',{reasonCode:$('[data-review-reason]').value}));
 $('[data-order-detail-refresh]').addEventListener('click',()=>order&&openOrder(order.reference));
 $('[data-order-lookup]').addEventListener('click',async()=>{
  const input=$('[data-order-token]');
  try{const result=await api('orders/lookup',{token:input.value.trim()});input.value='';renderOrder(result);message(null,'');}
  catch(error){message(error);}
 });
 $('[data-checkout-stop]').addEventListener('click',()=>changePolicy('set_enabled',{enabled:false}));
 $('[data-checkout-start]').addEventListener('click',()=>changePolicy('set_enabled',{enabled:true}));
 $('[data-checkout-update-quote]').addEventListener('click',()=>changePolicy('update_quote',{usdPerBtc:Number($('[data-checkout-quote]').value)}));
 async function refreshHealth(){
  try{const result=await api('health');$('[data-operations-health]').textContent=`Сховище: ${result.escrowPrivate?'приватне':'потрібна перевірка'}. Фонова перевірка: ${result.workerFresh?'працює':'застаріла або ще не запускалась'}.`;}
  catch{$('[data-operations-health]').textContent='Стан сервісів зараз недоступний.';}
 }
 $('[data-health-refresh]').addEventListener('click',refreshHealth);
 refreshHealth();
 return {openOrder,setPolicy};
}
