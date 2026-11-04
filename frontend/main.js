import { importRecipientKey, encryptDelivery } from "./pgp.js";

const CONFIG = {
  API_BASE: "/api",
  PUBKEY_URL: "/pubkey.asc",
  NAME_MIN: 2,
  NAME_MAX: 60,
  ADDRESS_MIN: 4,
  PHONE_MIN: 3
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const LS_CART_KEY = "mc_cart";
const SESSION_INVOICE_KEY = "mc_pending_invoice";

let CANDIES = [];
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let cart = [];
let pollTimer = null;
let countdownTimer = null;
let countdownLeftMs = 0;
let pollInFlight = false;
let encryptedPII = null;
let payToken = "";
let payAmountSats = 0;
let cachedPubKey = null;
let STOCK = new Map();

function usd(v){const n=Number(v);return Number.isFinite(n)?`$${n.toFixed(2)}`:"$0.00";}

function normalizeCartSchema(){
  cart=(Array.isArray(cart)?cart:[]).map(it=>{
    const src=CANDIES.find(c=>c.id===it?.id);
    const qty=Number(it?.qty);
    return src&&Number.isSafeInteger(qty)&&qty>0&&qty<=100
      ? { id:src.id,name:src.name,priceUsd:src.priceUsd,qty } : null;
  }).filter(Boolean);
}

function loadCart(){try{cart=JSON.parse(localStorage.getItem(LS_CART_KEY)||"[]");}catch{cart=[];}normalizeCartSchema();saveCart();}
function saveCart(){localStorage.setItem(LS_CART_KEY,JSON.stringify(cart));renderCartCount();}
function renderCartCount(){const c=cart.reduce((n,i)=>n+Number(i.qty),0);const el=$("#cartCount");if(el)el.textContent=String(c);}
function cartTotalUsd(){return cart.reduce((s,i)=>s+Number(i.priceUsd)*Number(i.qty),0);}

function setStage(id){["hero","catalog","checkout"].forEach(sec=>{const el=$("#"+sec);if(!el)return;sec===id?el.classList.remove("hidden"):el.classList.add("hidden");});}


async function fetchStock(){
  try{
    const r=await fetch("/api/products",{cache:"no-store"});
    if(!r.ok)throw Error("catalog_unavailable");
    const {products}=await r.json();
    if(!Array.isArray(products))throw Error("invalid_catalog");
    CANDIES=products.map(p=>({id:p.id,name:p.name,priceUsd:p.price,tag:(p.tags||[]).join(", "),
      color:["bglight","bgmint","bgchoc","bgpink","bgamber"].includes(p.color)?p.color:"bglight"}));
    STOCK=new Map(products.map(p=>[p.id,Number(p.stock||0)]));
    return true;
  }catch{CANDIES=[];STOCK=new Map();return false;}
}
function inCartQty(id){return (Array.isArray(cart)?cart:[]).reduce((s,it)=>s+(it.id===id?Number(it.qty||0):0),0);}

function renderGrid(list){
  const grid=$("#grid");if(!grid)return;grid.innerHTML="";
  if(!list.length)grid.innerHTML='<p class="empty-state">No matches. Try another search or refresh the page.</p>';
  list.forEach(item=>{
    const left=STOCK.has(item.id)?STOCK.get(item.id):0;
    const already=inCartQty(item.id);
    const canAdd=(left-already)>0;
    const card=document.createElement("div");
    card.className="card";
    const artId=/^c[1-8]$/.test(item.id)?item.id:null;
    card.innerHTML=`<div class="product-art ${item.color} ${artId?"pop-art pop-"+artId:""}" aria-hidden="true"><span class="product-index">SAMPLE / ${String(CANDIES.indexOf(item)+1).padStart(2,"0")}</span>${artId?`<img class="candy-illustration" src="/candy/${artId}.svg" alt="" width="360" height="300">`:`<div class="mini-candy"><span>✳</span></div>`}<span class="sample-seal">CA—LAB</span><span class="sample-barcode"></span></div><div class="product-info"><div class="product-stock">${left>0?"● In stock":"○ Out of stock"}</div><h3>${escapeHtml(item.name)}</h3><p class="product-tags">${escapeHtml(item.tag)||"Your next sweet discovery"}</p><div class="product-bottom"><strong>${usd(item.priceUsd)}</strong><button data-id="${escapeHtml(item.id)}" class="chip addBtn" ${canAdd?"":"disabled"} aria-label="Add ${escapeHtml(item.name)} to cart">${canAdd?"Add to cart +":"Unavailable"}</button></div></div>`;
    grid.appendChild(card);
  });
  $$(".addBtn").forEach(btn=>btn.addEventListener("click",()=>{const id=btn.getAttribute("data-id");const left=STOCK.has(id)?STOCK.get(id):0;const already=inCartQty(id);if(already+1>left){btn.setAttribute("disabled","disabled");btn.textContent="Unavailable";return;}addToCart(id);btn.classList.add("pulse");setTimeout(()=>btn.classList.remove("pulse"),300);}));
}
function filterAndSort(){const q=($("#q")?.value||"").trim().toLowerCase();const sort=$("#sort")?.value||"none";let list=CANDIES.filter(c=>c.name.toLowerCase().includes(q));if(sort==="asc")list.sort((a,b)=>a.priceUsd-b.priceUsd);if(sort==="desc")list.sort((a,b)=>b.priceUsd-a.priceUsd);renderGrid(list);}

function openDrawer(){$("#drawer")?.setAttribute("aria-hidden","false");$("#overlay")?.classList.add("show");$("#drawer")?.classList.add("show");renderDrawerList();}
function closeDrawer(){$("#drawer")?.setAttribute("aria-hidden","true");$("#overlay")?.classList.remove("show");$("#drawer")?.classList.remove("show");}
function renderDrawerList(){
  const list=$("#drawerList");if(!list)return;list.innerHTML="";
  if(!cart.length)list.innerHTML='<div class="empty-state">Nothing here yet.<br>Add a little sweet attitude.</div>';
  cart.forEach(i=>{
    const el=document.createElement("div");
    el.className="row-mid";el.style.justifyContent="space-between";
    el.innerHTML=`<div class="row-mid" style="gap:10px"><div class="bubble bglight"></div><div><div>${escapeHtml(i.name)}</div><small class="muted">${usd(i.priceUsd)}</small></div></div><div class="row-mid" style="gap:8px"><button class="qtybtn qtyBtn" data-id="${escapeHtml(i.id)}" data-d="-1">-</button><div>${i.qty}</div><button class="qtybtn qtyBtn" data-id="${escapeHtml(i.id)}" data-d="+1">+</button><button class="qtybtn rmBtn" data-id="${escapeHtml(i.id)}">×</button></div>`;
    list.appendChild(el);
  });
  const drawerTotalEl=$("#drawerTotal")||$("#total");if(drawerTotalEl)drawerTotalEl.textContent=usd(cartTotalUsd());
  $$(".rmBtn").forEach(b=>b.addEventListener("click",()=>removeFromCart(b.getAttribute("data-id"))));
  $$(".qtyBtn").forEach(b=>b.addEventListener("click",()=>{const id=b.getAttribute("data-id");const d=b.getAttribute("data-d")==="+1"?1:-1;changeQty(id,d);}));
}

function addToCart(id){
  const it=CANDIES.find(x=>x.id===id);if(!it)return;
  const left=STOCK.has(id)?STOCK.get(id):0;
  const already=inCartQty(id);
  if(already+1>left)return;
  const ex=cart.find(x=>x.id===id);
  if(ex)ex.qty+=1;else cart.push({id,name:it.name,priceUsd:it.priceUsd,qty:1});
  saveCart();renderDrawerList();
}
function removeFromCart(id){cart=cart.filter(x=>x.id!==id);saveCart();renderDrawerList();}
function changeQty(id,d){
  const ex=cart.find(x=>x.id===id);if(!ex)return;
  const left=STOCK.has(id)?STOCK.get(id):0;
  let next=ex.qty+d;
  if(next<=0){removeFromCart(id);return;}
  if(next>left)next=left;
  ex.qty=next;saveCart();renderDrawerList();
}

function renderCheckoutCart(){
  const box=$("#cartList");if(!box)return;box.innerHTML="";
  cart.forEach(i=>{const row=document.createElement("div");row.className="row-mid";row.style.justifyContent="space-between";row.innerHTML=`<div>${escapeHtml(i.name)} × ${i.qty}</div><div>${usd(Number(i.priceUsd)*Number(i.qty))}</div>`;box.appendChild(row);});
  const totalEl=$("#total")||$("#checkoutTotal");if(totalEl)totalEl.textContent=usd(cartTotalUsd());
}

function setPayUi({address,token,amountSats}){$("#payAddress")?.replaceChildren(document.createTextNode(address||""));const amt=Number(amountSats||0);if($("#payAmount"))$("#payAmount").textContent=String(amt);if($("#payToken"))$("#payToken").textContent=token||"";const btcStr=(amt/1e8).toFixed(8);const uri=`bitcoin:${address}?amount=${btcStr}`;if($("#btcUri"))$("#btcUri").textContent=uri;$("#payBox")?.classList.remove("hidden");}

async function createPaymentViaApi(){
  const url=`${CONFIG.API_BASE}/pay/create`;
  
  const lines=cart.map(i=>({sku:i.id,qty:i.qty}));
  const res=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({lines,quotedTotalCents:cart.reduce((sum,i)=>sum+Math.round(i.priceUsd*100)*i.qty,0)})});
  if(!res.ok){
    const error=await res.json().catch(()=>({}));
    if(error.error==="catalog_price_changed"){
      if(await fetchStock()){normalizeCartSchema();saveCart();renderCheckoutCart();renderDrawerList();filterAndSort();}
      throw new Error("catalog_price_changed");
    }
    throw new Error(error.error || String(res.status));
  }
  return res.json();
}

function setFieldError(id, msg){
  const f=$("#"+id)?.closest(".field")||$("#"+id);
  if(f)f.classList.add("error");
  const note=f?.querySelector(".note");
  if(note)note.textContent=msg||"";
}
function clearFieldErrors(){
  $$(".field.error").forEach(n=>n.classList.remove("error"));
  $$(".field .note").forEach(n=>n.textContent="");
}
function showInlineError(msg){
  const el=$("#inlineError")||$("#payStatus");
  if(el)el.textContent=String(msg||"");
}
function showDialog(msg){
  const dlg=$("#dialogMsg");
  const box=$("#dialog");
  if(dlg)dlg.textContent=String(msg||"");
  if(box)box.classList.add("show");
}
function hideDialog(){
  const box=$("#dialog");
  if(box)box.classList.remove("show");
}

async function getPubKey(){
  if(cachedPubKey)return cachedPubKey;
  const r=await fetch(CONFIG.PUBKEY_URL,{cache:"no-cache",headers:{accept:"text/plain"}});
  if(!r.ok)throw new Error("pubkey_fetch_failed");
  const asc=await r.text();
  const key=await importRecipientKey(asc);
  cachedPubKey=key;
  return key;
}

function validateInputs(){
  clearFieldErrors();
  const name=($("#fldName")?.value||"").trim();
  const address=($("#fldAddr")?.value||"").trim();
  const phone=($("#fldPhone")?.value||"").trim();
  let ok=true;
  if(name.length<CONFIG.NAME_MIN||name.length>CONFIG.NAME_MAX){setFieldError("fldName",`Enter your name (${CONFIG.NAME_MIN}–${CONFIG.NAME_MAX} characters)`);ok=false;}
  if(address.length<CONFIG.ADDRESS_MIN){setFieldError("fldAddr","Enter a delivery address");ok=false;}
  if(phone.length<CONFIG.PHONE_MIN){setFieldError("fldPhone","Enter a phone number");ok=false;}
  return { ok, name, address, phone };
}

async function encryptPII(details) {
  return encryptDelivery(details,await getPubKey());
}

async function startPayment(){
  if(cart.length===0)return;
  const v=validateInputs();
  if(!v.ok){showInlineError("Please check your delivery details");return;}
  const btn=$("#btnContinuePay");
  const prevText=btn?.textContent;
  try{
    btn&&(btn.disabled=true,btn.textContent="Processing…");
    payAmountSats=0;
    encryptedPII=await encryptPII(v);
    const d=await createPaymentViaApi();
    const addr=String(d.address||"");
    const token=String(d.token||"");
    payAmountSats=Number(d.amountSats);
    if(!/^[a-zA-Z0-9]{14,90}$/.test(addr)||!/^[0-9a-f-]{36}$/i.test(token)||!Number.isSafeInteger(payAmountSats)||payAmountSats<=0)throw new Error("invalid_invoice");
    const escrow=await fetch(`${CONFIG.API_BASE}/shipment/escrow`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,data:encryptedPII})});
    if(!escrow.ok)throw new Error("encrypted_escrow_failed");
    encryptedPII=null;
    payToken=token;
    sessionStorage.setItem(SESSION_INVOICE_KEY,JSON.stringify({token,address:addr,amountSats:payAmountSats,createdAt:Date.now()}));
    ["fldName","fldAddr","fldPhone"].forEach(id=>{const field=$("#"+id);if(field)field.value="";});
    setPayUi({address:addr,token,amountSats:payAmountSats});startCountdown(20*60*1000);startPolling();showInlineError("");await fetchStock();filterAndSort();
  }catch(e){
    const map={below_minimum_btc_amount:"Your cart is below the BTC minimum. Add more items.",checkout_disabled:"New payments are currently paused.",btc_quote_expired:"The BTC quote needs updating. Please try later.",checkout_rate_limited:"Too many invoices. Try again in a minute.",out_of_stock:"An item has been reserved by another customer. Refresh your cart.",checkout_changed_retry:"Stock has changed. Please try checkout again.",catalog_price_changed:"Prices have changed. Check the new total and try checkout again.",pubkey_fetch_failed:"Could not load the public encryption key.",invalid_public_key:"The encryption key is invalid or unusable.",invalid_invoice:"The server returned an invalid invoice.",encrypted_escrow_failed:"Could not securely save delivery details. Do not send payment."};
    encryptedPII=null;
    showInlineError(map[e?.message]||"Could not encrypt details or create the payment");
    showDialog(map[e?.message]||"PGP encryption failed.");
  }finally{
    if(btn){btn.disabled=false;btn.textContent=prevText;}
  }
}

function startCountdown(ms){
  clearInterval(countdownTimer);countdownLeftMs=ms;
  countdownTimer=setInterval(()=>{countdownLeftMs-=1000;if(countdownLeftMs<=0){clearInterval(countdownTimer);const el=$("#payStatus");if(el)el.textContent="Expired";return;}const m=Math.floor(countdownLeftMs/60000);const s=Math.floor((countdownLeftMs%60000)/1000);const cd=$("#countdown");if(cd)cd.textContent=`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;},1000);
}

function afterPaid(){
  sessionStorage.removeItem(SESSION_INVOICE_KEY);
  encryptedPII=null;payToken="";
  ["fldName","fldAddr","fldPhone"].forEach(id=>{const field=$("#"+id);if(field)field.value="";});
  $("#result")?.classList.remove("hidden");
  if($("#result"))$("#result").textContent="Payment confirmed. Your order is saved and awaiting shipment.";
  cart=[];saveCart();renderDrawerList();renderCheckoutCart();
}

function stopPolling(){clearInterval(pollTimer);pollTimer=null;}
async function pollOnce(){
  if(!payToken||!payAmountSats||pollInFlight)return;
  pollInFlight=true;
  try{
    const res=await fetch(`${CONFIG.API_BASE}/pay/status?token=${encodeURIComponent(payToken)}`,{cache:"no-store"});
    const payment=await res.json();
    const status=$("#payStatus");
    if(res.ok && payment.paid===true){
      stopPolling();clearInterval(countdownTimer);
      if(["PENDING","HANDOFF_READY","FULFILLED"].includes(payment.fulfillmentStatus)){
        if(status)status.textContent="Payment confirmed";
        afterPaid();
      }else if(status)status.textContent="Payment found. Your order needs a support review.";
    }else{
      const messages={PENDING:"Awaiting payment",PARTIALLY_PAID:"Partial payment received",
        CONFIRMING:"Waiting for Bitcoin confirmations",EXPIRED:"Invoice expired. Do not send payment.",
        LATE_PAYMENT:"Payment arrived after expiry. Contact support.",
        REORG_REVIEW:"Bitcoin confirmations changed. A support review is required.",
        INVOICE_REVIEW:"This invoice needs a support review.",
        PROVIDER_DISAGREEMENT:"Payment verification sources disagree. A support review is required.",
        ESCROW_MISSING:"Saved delivery details were not found. Contact support."};
      if(status)status.textContent=messages[payment.status] || "Payment verification is temporarily unavailable. Retrying…";
    }
  }catch{const status=$("#payStatus");if(status)status.textContent="Payment verification is temporarily unavailable. Retrying…";}
  finally{pollInFlight=false;}
}
function startPolling(){stopPolling();pollTimer=setInterval(pollOnce,10000);pollOnce();}

function copyText(s){try{navigator.clipboard.writeText(s);}catch{}}
function setupCopyButtons(){
  $("#btnCopyAddress")?.addEventListener("click",()=>{const t=$("#payAddress")?.textContent?.trim()||"";if(t)copyText(t);});
  $("#btnCopyToken")?.addEventListener("click",()=>{const t=$("#payToken")?.textContent?.trim()||"";if(t)copyText(t);});
  $("#btnCopyUri")?.addEventListener("click",()=>{const t=$("#btcUri")?.textContent?.trim()||"";if(t)copyText(t);});
  $("#btnRefreshStatus")?.addEventListener("click",()=>{if(payToken)pollOnce();});
}
function tryOpenWallet(){
  const uri=$("#btcUri")?.textContent?.trim();if(!uri)return;
  const prev=document.visibilityState;let opened=false;
  const t=setTimeout(()=>{if(!opened)$("#walletHelp")?.classList.remove("hidden");},1200);
  const onVis=()=>{const curr=document.visibilityState;if(prev!==curr){opened=true;document.removeEventListener("visibilitychange",onVis);clearTimeout(t);}};
  document.addEventListener("visibilitychange",onVis);
  window.location.href=uri;
}

function wireNav(){
  $("#btnHome")?.addEventListener("click",()=>setStage("hero"));
  $("#btnBrowse")?.addEventListener("click",()=>{setStage("catalog");filterAndSort();});
  $("#btnBrowse2")?.addEventListener("click",()=>{setStage("catalog");filterAndSort();});
  $("#btnBuy")?.addEventListener("click",()=>{setStage("catalog");filterAndSort();});
  $("#btnProceed")?.addEventListener("click",()=>{if(cart.length===0)return;setStage("checkout");renderCheckoutCart();});
  $("#btnBackToCatalog")?.addEventListener("click",()=>setStage("catalog"));
  $("#btnContinuePay")?.addEventListener("click",()=>startPayment());
  $("#btnOpenWallet")?.addEventListener("click",tryOpenWallet);
  $("#btnOpenCart")?.addEventListener("click",openDrawer);
  $("#btnCloseCart")?.addEventListener("click",closeDrawer);
  $("#btnDrawerCheckout")?.addEventListener("click",()=>{if(cart.length===0)return;closeDrawer();setStage("checkout");renderCheckoutCart();});
  $("#overlay")?.addEventListener("click",closeDrawer);
  $("#dlgClose")?.addEventListener("click",hideDialog);
}
function wireSearch(){$("#q")?.addEventListener("input",filterAndSort);$("#sort")?.addEventListener("change",filterAndSort);}

function resumePendingInvoice(){
  try {
    const raw=sessionStorage.getItem(SESSION_INVOICE_KEY);
    if(!raw)return false;
    const invoice=JSON.parse(raw);
    if(!/^[0-9a-f-]{36}$/i.test(invoice.token)||
       !/^[a-zA-Z0-9]{14,90}$/.test(invoice.address)||
       !Number.isSafeInteger(invoice.amountSats)||invoice.amountSats<=0||
       !Number.isFinite(invoice.createdAt))throw Error("invalid_resume");
    payToken=invoice.token;payAmountSats=invoice.amountSats;
    setPayUi(invoice);
    const left=Math.max(0,20*60*1000-(Date.now()-invoice.createdAt));
    startCountdown(left);
    startPolling();
    setStage("checkout");
    showInlineError("Invoice restored. Encrypted delivery details are already saved on the server.");
    return true;
  }catch{
    sessionStorage.removeItem(SESSION_INVOICE_KEY);
    return false;
  }
}
async function init(){const available=await fetchStock();if(available)loadCart();else showInlineError("The collection is temporarily unavailable. Please refresh later.");renderGrid(CANDIES);wireNav();wireSearch();setupCopyButtons();if(!resumePendingInvoice())setStage("hero");}
document.addEventListener("DOMContentLoaded",init);
