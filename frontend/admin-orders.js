const paymentLabels={PENDING:'Очікує оплати',PARTIALLY_PAID:'Часткова оплата',CONFIRMING:'Очікує підтверджень',
  PAID:'Оплату підтверджено',EXPIRED:'Термін минув',LATE_PAYMENT:'Пізній платіж',REORG_REVIEW:'Змінилися підтвердження BTC',
  INVOICE_REVIEW:'Потрібна перевірка рахунку',PROVIDER_DISAGREEMENT:'Дані провайдерів різняться',
  ESCROW_MISSING:'Не знайдено даних доставки',SETTLEMENT_PENDING:'Не завершено списання товару',
  VERIFICATION_UNAVAILABLE:'Перевірка оплати недоступна'};
const fulfillmentLabels={PENDING:'Очікує відправлення',ON_HOLD:'Призупинено',HANDOFF_READY:'Підготовлено до ручного передавання',FULFILLED:'Ручне передавання підтверджено'};
const errors={unauthorized:'Немає доступу. Увійдіть з правильним ключем адміністратора.',
  invalid_cursor:'Термін сторінки минув. Натисніть «Оновити».',
  orders_unavailable:'Не вдалося завантажити замовлення. Спробуйте оновити список.'};

export function createOrdersController({request,onChange}) {
  let rows=new Map(),generation=0,abort;
  let state={orders:[],filter:'all',nextCursor:null,loading:false,error:null,loaded:false};
  const emit=()=>onChange({...state,orders:[...state.orders]});
  async function load({reset=false,filter=state.filter}={}) {
    if(state.loading&&!reset)return;
    if(!reset&&state.loaded&&!state.nextCursor)return;
    const current=++generation;
    abort?.abort();abort=new AbortController();
    if(reset){rows=new Map();state={...state,orders:[],nextCursor:null,loaded:false};}
    state={...state,filter,loading:true,error:null};emit();
    try {
      const result=await request({filter,cursor:state.nextCursor,signal:abort.signal});
      if(current!==generation)return;
      if(!Array.isArray(result.orders))throw Error('orders_unavailable');
      for(const order of result.orders)rows.set(order.reference,order);
      state={...state,orders:[...rows.values()].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')),
        nextCursor:result.nextCursor || null,loaded:true};
    } catch(error) {
      if(current!==generation)return;
      state={...state,error:errors[error.message] || errors.orders_unavailable};
    } finally {if(current===generation){state={...state,loading:false};emit();}}
  }
  return {load,refresh:()=>load({reset:true}),setFilter:filter=>load({reset:true,filter}),
    snapshot:()=>({...state,orders:[...state.orders]})};
}

export function mountOrdersPanel({root,getAdminKey,fetchImpl=fetch,onSelect=()=>{}}) {
  const select=root.querySelector('[data-order-filter]'),refresh=root.querySelector('[data-order-refresh]');
  const more=root.querySelector('[data-order-more]'),body=root.querySelector('[data-order-rows]');
  const message=root.querySelector('[data-order-message]'),summary=root.querySelector('[data-order-summary]');
  const formatter=new Intl.DateTimeFormat('uk-UA',{dateStyle:'short',timeStyle:'short'});
  const formatDate=value=>value&&Number.isFinite(Date.parse(value))?formatter.format(new Date(value)):'—';
  function cell(row,text){const td=document.createElement('td');td.textContent=text;row.appendChild(td);return td;}
  const controller=createOrdersController({
    request:async({filter,cursor,signal})=>{
      const params=new URLSearchParams({filter});if(cursor)params.set('cursor',cursor);
      const response=await fetchImpl('/api/dash/orders?'+params,{cache:'no-store',signal,
        headers:{'x-admin-key':getAdminKey()}});
      const result=await response.json();if(!response.ok)throw Error(result.error || 'orders_unavailable');return result;
    },
    onChange:state=>{
      refresh.disabled=state.loading;more.disabled=state.loading;more.hidden=!state.nextCursor;
      select.value=state.filter;
      message.textContent=state.error || (state.loading?'Завантаження…':
        !state.orders.length?(state.nextCursor?'У цій порції немає відповідних замовлень. Завантажте наступну.':'Замовлень за цим фільтром немає.'):'');
      message.setAttribute('role',state.error?'alert':'status');
      summary.textContent=`Завантажено: ${state.orders.length}. Потребують уваги: ${state.orders.filter(order=>order.needsReview).length}.`;
      body.replaceChildren();
      for(const order of state.orders){
        const row=document.createElement('tr');if(order.needsReview)row.className='order-attention';
        cell(row,order.reference);cell(row,formatDate(order.createdAt));
        cell(row,order.amountSats===null?'—':`${order.amountSats.toLocaleString('uk-UA')} sats`);
        cell(row,order.settledSats===null?'—':`${order.settledSats.toLocaleString('uk-UA')} sats`);
        cell(row,order.items.map(item=>`${item.sku} × ${item.quantity}`).join(', ') || '—');
        cell(row,paymentLabels[order.paymentStatus] || paymentLabels.INVOICE_REVIEW);
        cell(row,fulfillmentLabels[order.fulfillmentStatus] || 'Не створено');
        cell(row,formatDate(order.lastCheckedAt)+(order.verificationStale?' · перевірка застаріла':''));
        const action=document.createElement('button');action.className='btn btn-ghost';action.textContent='Відкрити';
        action.addEventListener('click',()=>onSelect(order.reference));const actionCell=document.createElement('td');actionCell.appendChild(action);row.appendChild(actionCell);
        body.appendChild(row);
      }
    }
  });
  refresh.addEventListener('click',()=>controller.refresh());
  more.addEventListener('click',()=>controller.load());
  select.addEventListener('change',()=>controller.setFilter(select.value));
  return controller;
}
