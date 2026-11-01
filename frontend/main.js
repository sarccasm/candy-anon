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

const CANDIES = [
  { id: "c1", name: "Caramel Swirl", priceUsd: 3.5, tag: "light", color: "bglight" },
  { id: "c2", name: "Mint Blizz",    priceUsd: 2.9, tag: "mint",  color: "bgmint"  },
  { id: "c3", name: "Dark Bite",     priceUsd: 4.2, tag: "dark",  color: "bgchoc"  },
  { id: "c4", name: "Berry Pop",     priceUsd: 3.1, tag: "fruit", color: "bgpink"  },
  { id: "c5", name: "Zesty Lemon",   priceUsd: 2.7, tag: "fruit", color: "bgamber" },
  { id: "c6", name: "Nutty Crunch",  priceUsd: 4.8, tag: "nuts",  color: "bgamber" },
  { id: "c7", name: "Velvet Cocoa",  priceUsd: 5.2, tag: "dark",  color: "bgchoc"  },
  { id: "c8", name: "Honey Drop",    priceUsd: 2.5, tag: "light", color: "bglight" }
];

let cart = [];
let pollTimer = null;
let countdownTimer = null;
let countdownLeftMs = 0;
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
function animateTitle(){const t=$("#title");if(!t)return;const s="MYCANDY";t.innerHTML="";for(let i=0;i<s.length;i++){const span=document.createElement("span");span.textContent=s[i];span.style.display="inline-block";span.style.transform="translateY(-120px) rotate(-5deg)";span.style.opacity="0";span.style.animation="drop .9s forwards";span.style.animationDelay=`${i*60}ms`;t.appendChild(span);}}

async function fetchStock(){
  try{
    const r=await fetch("/api/products");
    if(!r.ok){STOCK=new Map();return;}
    const {products=[]}=await r.json();
    STOCK=new Map(products.map(p=>[p.id,Number(p.stock||0)]));
  }catch{STOCK=new Map();}
}
function inCartQty(id){return (Array.isArray(cart)?cart:[]).reduce((s,it)=>s+(it.id===id?Number(it.qty||0):0),0);}

function renderGrid(list){
  const grid=$("#grid");if(!grid)return;grid.innerHTML="";
  list.forEach(item=>{
    const left=STOCK.has(item.id)?STOCK.get(item.id):0;
    const already=inCartQty(item.id);
    const canAdd=(left-already)>0;
    const card=document.createElement("div");
    card.className="card";
    card.innerHTML=`<div class="row-mid" style="gap:12px"><div class="bubble ${item.color}"></div><div><h3>${item.name}</h3><small>${usd(item.priceUsd)}</small><div class="row" style="gap:8px;margin-top:6px"><small class="muted">In stock: ${left}</small></div></div></div><div class="row"><button data-id="${item.id}" class="chip addBtn" ${canAdd?"":"disabled"}>${canAdd?"Add":"Sold out"}</button><small class="muted">${item.tag}</small></div>`;
    grid.appendChild(card);
  });
  $$(".addBtn").forEach(btn=>btn.addEventListener("click",()=>{const id=btn.getAttribute("data-id");const left=STOCK.has(id)?STOCK.get(id):0;const already=inCartQty(id);if(already+1>left){btn.setAttribute("disabled","disabled");btn.textContent="Sold out";return;}addToCart(id);btn.classList.add("pulse");setTimeout(()=>btn.classList.remove("pulse"),300);}));
}
function filterAndSort(){const q=($("#q")?.value||"").trim().toLowerCase();const sort=$("#sort")?.value||"none";let list=CANDIES.filter(c=>c.name.toLowerCase().includes(q));if(sort==="asc")list.sort((a,b)=>a.priceUsd-b.priceUsd);if(sort==="desc")list.sort((a,b)=>b.priceUsd-a.priceUsd);renderGrid(list);}

function openDrawer(){$("#overlay")?.classList.add("show");$("#drawer")?.classList.add("show");renderDrawerList();}
function closeDrawer(){$("#overlay")?.classList.remove("show");$("#drawer")?.classList.remove("show");}
function renderDrawerList(){
  const list=$("#drawerList");if(!list)return;list.innerHTML="";
  cart.forEach(i=>{
    const el=document.createElement("div");
    el.className="row-mid";el.style.justifyContent="space-between";
    el.innerHTML=`<div class="row-mid" style="gap:10px"><div class="bubble bglight"></div><div><div>${i.name}</div><small class="muted">${usd(i.priceUsd)}</small></div></div><div class="row-mid" style="gap:8px"><button class="qtybtn qtyBtn" data-id="${i.id}" data-d="-1">-</button><div>${i.qty}</div><button class="qtybtn qtyBtn" data-id="${i.id}" data-d="+1">+</button><button class="qtybtn rmBtn" data-id="${i.id}">×</button></div>`;
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
  cart.forEach(i=>{const row=document.createElement("div");row.className="row-mid";row.style.justifyContent="space-between";row.innerHTML=`<div>${i.name} × ${i.qty}</div><div>${usd(Number(i.priceUsd)*Number(i.qty))}</div>`;box.appendChild(row);});
  const totalEl=$("#total")||$("#checkoutTotal");if(totalEl)totalEl.textContent=usd(cartTotalUsd());
}

function setPayUi({address,token,amountSats}){$("#payAddress")?.replaceChildren(document.createTextNode(address||""));const amt=Number(amountSats||0);if($("#payAmount"))$("#payAmount").textContent=String(amt);if($("#payToken"))$("#payToken").textContent=token||"";const btcStr=(amt/1e8).toFixed(8);const uri=`bitcoin:${address}?amount=${btcStr}`;if($("#btcUri"))$("#btcUri").textContent=uri;$("#payBox")?.classList.remove("hidden");}

async function createPaymentViaApi(){
  const url=`${CONFIG.API_BASE}/pay/create`;
  
  const lines=cart.map(i=>({sku:i.id,qty:i.qty}));
  const res=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({lines})});
  if(!res.ok)throw new Error(String(res.status));
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
  if(name.length<CONFIG.NAME_MIN||name.length>CONFIG.NAME_MAX){setFieldError("fldName",`Вкажіть ім'я (${CONFIG.NAME_MIN}–${CONFIG.NAME_MAX} символів)`);ok=false;}
  if(address.length<CONFIG.ADDRESS_MIN){setFieldError("fldAddr","Вкажіть адресу доставки");ok=false;}
  if(phone.length<CONFIG.PHONE_MIN){setFieldError("fldPhone","Вкажіть телефон");ok=false;}
  return { ok, name, address, phone };
}

async function encryptPII(details) {
  return encryptDelivery(details,await getPubKey());
}

async function startPayment(){
  if(cart.length===0)return;
  const v=validateInputs();
  if(!v.ok){showInlineError("Заповніть коректно поля форми");return;}
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
    payToken=token;setPayUi({address:addr,token,amountSats:payAmountSats});startCountdown(20*60*1000);startPolling();showInlineError("");await fetchStock();filterAndSort();
  }catch(e){
    const map={pubkey_fetch_failed:"Не вдалося завантажити відкритий ключ.",invalid_public_key:"Невірний або непридатний ключ шифрування.",invalid_invoice:"Сервер повернув некоректний рахунок."};
    showInlineError(map[e?.message]||"Помилка під час шифрування/створення платежу");
    showDialog(map[e?.message]||"Помилка під час шифрування PGP.");
  }finally{
    if(btn){btn.disabled=false;btn.textContent=prevText;}
  }
}

function startCountdown(ms){
  clearInterval(countdownTimer);countdownLeftMs=ms;
  countdownTimer=setInterval(()=>{countdownLeftMs-=1000;if(countdownLeftMs<=0){clearInterval(countdownTimer);const el=$("#payStatus");if(el)el.textContent="Expired";return;}const m=Math.floor(countdownLeftMs/60000);const s=Math.floor((countdownLeftMs%60000)/1000);const cd=$("#countdown");if(cd)cd.textContent=`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;},1000);
}

async function afterPaid(){
  const url=`${CONFIG.API_BASE}/create-shipment`;
  try{
    const res=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:payToken,data:encryptedPII})});
    if(res.ok||res.status===409){encryptedPII=null;payToken="";["fldName","fldAddr","fldPhone"].forEach(id=>{const f=$("#"+id);if(f)f.value="";});$("#result")?.classList.remove("hidden");if($("#result"))$("#result").textContent="Order placed. Thank you!";cart=[];saveCart();renderDrawerList();renderCheckoutCart();}
    else{showInlineError("Не вдалося створити відправлення");}
  }catch{showInlineError("Не вдалося створити відправлення");}
}

function stopPolling(){clearInterval(pollTimer);pollTimer=null;}
async function pollOnce(){
  if(!payToken||!payAmountSats)return;
  const url=`${CONFIG.API_BASE}/pay/status?token=${encodeURIComponent(payToken)}`;
  let paid=false;let unavailable=false;
  try{const res=await fetch(url,{cache:"no-store"});if(res.ok){const j=await res.json();paid=j.paid===true;}else unavailable=true;}catch{unavailable=true;}
  const st=$("#payStatus");
  if(paid){stopPolling();clearInterval(countdownTimer);if(st)st.textContent="Paid";await afterPaid();}else{if(st)st.textContent=unavailable?"Payment status unavailable. Retrying…":"Not paid yet";}
}
function startPolling(){stopPolling();pollTimer=setInterval(pollOnce,10000);pollOnce();}

function copyText(s){try{navigator.clipboard.writeText(s);}catch{}}
function setupCopyButtons(){
  $("#btnCopyAddress")?.addEventListener("click",()=>{const t=$("#payAddress")?.textContent?.trim()||"";if(t)copyText(t);});
  $("#btnCopyToken")?.addEventListener("click",()=>{const t=$("#payToken")?.textContent?.trim()||"";if(t)copyText(t);});
  $("#btnCopyUri")?.addEventListener("click",()=>{const t=$("#btcUri")?.textContent?.trim()||"";if(t)copyText(t);});
  $("#btnRefreshStatus")?.addEventListener("click",()=>pollOnce());
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

async function init(){loadCart();animateTitle();await fetchStock();renderGrid(CANDIES);wireNav();wireSearch();setupCopyButtons();setStage("hero");}
document.addEventListener("DOMContentLoaded",init);
