'use strict';
/* ════════════════════════════════════════════
   SOUTH AFRICAN TAX
   VAT is 15% (the shop's own rate in Settings is used if set).
   Employers pay UIF 1% + SDL 1% on salaries.
════════════════════════════════════════════ */
const vatRate = () => Number(db?.settings?.tva) || 15;
// VAT contained in an amount that includes VAT.
const vatIncluded = amount => Math.round(amount*vatRate()/(100+vatRate()));
const EMPLOYER_LEVY_RATE = 0.02;
const employerLevies = salary => Math.round(salary*EMPLOYER_LEVY_RATE);

/* ════════════════════════════════════════════
   DATA
════════════════════════════════════════════ */
const CATS = {
  Food:['Cereals & starches','Oils & fats','Dry groceries','Dairy','Canned goods','Condiments','Snacks'],
  Hygiene:['Household cleaning','Personal care','Baby products','Disinfectants'],
  Drinks:['Water & soft drinks','Fruit juice','Energy drinks','Alcohol'],
  Hardware:['Household items','Tools','Screws & bolts','Electricity'],
  Electronics:['Phones','Accessories','Audio','Computing'],
  Textiles:['Men\'s clothing','Women\'s clothing','Children','Fabric'],
  'Building materials':['Cement & mortar','Paint','Plumbing','Tiling'],
  Other:['Miscellaneous']
};
const USERS = {
  admin:     {pass:'kinta2026', role:'admin',    label:'Manager',        initials:'G'},
  caissier1: {pass:'caisse123', role:'cashier', label:'Cashier',      initials:'C'},
  vendeur1:  {pass:'vente123',  role:'salesperson',  label:'Salesperson',       initials:'V'},
};
const STORE_KEY = 'kinta_v5_db';
const TOKEN_KEY = 'kinta_api_token';
let API_TOKEN = sessionStorage.getItem(TOKEN_KEY) || '';
let STATE_VERSION = null;
let TEST_CLOCK_ENABLED = false;
let TEST_CLOCK_ACTIVE = false;
let TEST_CLOCK_OFFSET_MS = 0;

async function apiCall(method, endpoint, body){
  const options={method,headers:{'Content-Type':'application/json'}};
  if(API_TOKEN)options.headers.Authorization='Bearer '+API_TOKEN;
  if(body!==undefined)options.body=JSON.stringify(body);
  let response;
  try{response=await fetch('/api'+endpoint,options);}
  catch(_){throw new Error('Server unreachable. Check your connection.');}
  let data={};try{data=await response.json();}catch(_){}
  if(response.status===401&&endpoint!=='/auth/login'){API_TOKEN='';sessionStorage.removeItem(TOKEN_KEY);}
  if(!response.ok){const error=new Error(data.error||'Server error');error.code=data.code;error.status=response.status;throw error;}
  return data;
}

// Demo data for a new shop. Amounts are written in rand with R(); statuses,
// payment modes and categories keep their internal (French) keys.
const DEF = {
  settings:{nom:'Kinta Demo Store',adresse:'12 Vilakazi Street, Orlando West, Soweto',tel:'+27 11 000 0000',email:'',rccm:'',niu:'',devise:'ZAR',tva:15,mentions:'Payment is due within 30 days. Interest may be charged on overdue accounts.'},
  clients:[
    {id:'C001',nom:'Mama Thandi Spaza',tel:'+27 72 521 4412',email:'thandi@gmail.com',ville:'Soweto',solde:R(2450),type:'Retailer',credit:R(5750)},
    {id:'C002',nom:'Mokoena General Dealer',tel:'+27 83 332 1987',email:'mokoena@outlook.com',ville:'Johannesburg',solde:0,type:'Wholesaler',credit:R(14400)},
    {id:'C003',nom:'Naidoo & Sons Wholesale',tel:'+27 82 774 2801',email:'',ville:'Durban',solde:R(3460),type:'Wholesaler',credit:R(8650)},
    {id:'C004',nom:'Khumalo Corner Shop',tel:'+27 71 111 5533',email:'',ville:'Pretoria',solde:0,type:'Retailer',credit:R(2900)},
    {id:'C005',nom:'Sipho Tuck Shop',tel:'+27 73 888 1245',email:'sipho@gmail.com',ville:'Soweto',solde:R(1000),type:'Retailer',credit:R(4300)},
  ],
  produits:[
    {id:'P001',nom:'Long-grain rice 10kg',ref:'RIC-001',bc:'6001234000001',cat:'Food',scat:'Cereals & starches',stk:120,min:20,pa:R(145),pv:R(179.99),lot:'LOT-A1',exp:'2027-03-01'},
    {id:'P002',nom:'Sunflower oil 2L',ref:'OIL-002',bc:'6001234000002',cat:'Food',scat:'Oils & fats',stk:45,min:20,pa:R(62),pv:R(79.99),lot:'',exp:'2026-09-15'},
    {id:'P003',nom:'White sugar 10kg',ref:'SUG-003',bc:'6001234000003',cat:'Food',scat:'Dry groceries',stk:0,min:10,pa:R(165),pv:R(199.99),lot:'',exp:'2027-12-01'},
    {id:'P004',nom:'Super maize meal 10kg',ref:'MAI-004',bc:'',cat:'Food',scat:'Cereals & starches',stk:6,min:15,pa:R(105),pv:R(129.99),lot:'LOT-B2',exp:'2026-08-01'},
    {id:'P005',nom:'Washing powder 2kg',ref:'WAS-005',bc:'',cat:'Hygiene',scat:'Household cleaning',stk:85,min:30,pa:R(68),pv:R(89.99),lot:'',exp:''},
    {id:'P006',nom:'Long-life milk 1L',ref:'MIL-006',bc:'',cat:'Food',scat:'Dairy',stk:32,min:20,pa:R(17),pv:R(22.99),lot:'LOT-C3',exp:'2026-07-01'},
    {id:'P007',nom:'Still water 1.5L',ref:'WAT-007',bc:'',cat:'Drinks',scat:'Water & soft drinks',stk:200,min:50,pa:R(9),pv:R(13.99),lot:'',exp:'2026-12-01'},
    {id:'P008',nom:'Cola 330ml can',ref:'COL-008',bc:'',cat:'Drinks',scat:'Water & soft drinks',stk:0,min:24,pa:R(8.5),pv:R(12.99),lot:'',exp:'2026-10-01'},
  ],
  fournisseurs:[
    {id:'F001',nom:'Metro Cash & Carry Supplies',tel:'+27 11 210 3344',email:'orders@example.co.za',cat:'Food',adr:'City Deep, Johannesburg',derniere:'2026-04-20'},
    {id:'F002',nom:'Durban Import Traders',tel:'+27 31 887 2211',email:'sales@example.co.za',cat:'Import-export',adr:'Port of Durban',derniere:'2026-04-18'},
  ],
  factures:[
    {id:'V001',num:'TK-2026-00128',client:'Mama Thandi Spaza',date:'2026-05-12',ech:'2026-06-12',montant:R(1699.85),statut:'Paid',mode:'Cash',lignes:[{d:'Long-grain rice 10kg',q:5,pu:R(179.99),t:R(899.95)},{d:'Sunflower oil 2L',q:10,pu:R(79.99),t:R(799.9)}]},
    {id:'V002',num:'TK-2026-00127',client:'Mokoena General Dealer',date:'2026-05-12',ech:'2026-06-12',montant:R(2300),statut:'Paid',mode:'Bank card',lignes:[]},
    {id:'V003',num:'TK-2026-00126',client:'Naidoo & Sons Wholesale',date:'2026-05-12',ech:'2026-06-12',montant:R(5750),statut:'Paid',mode:'Bank transfer',lignes:[]},
    {id:'V004',num:'TK-2026-00125',client:'Khumalo Corner Shop',date:'2026-05-11',ech:'2026-06-11',montant:R(1300),statut:'Pending',mode:'Cash',lignes:[]},
    {id:'V005',num:'TK-2026-00124',client:'Sipho Tuck Shop',date:'2026-05-11',ech:'2026-06-11',montant:R(2750),statut:'Pending',mode:'Bank card',lignes:[]},
    {id:'V006',num:'TK-2026-00123',client:'Mama Thandi Spaza',date:'2026-05-11',ech:'2026-06-11',montant:R(4300),statut:'Paid',mode:'Bank transfer',lignes:[]},
  ],
  mouvements:[
    {id:'MV001',date:'2026-05-12',lib:'Sale TK-2026-00128',type:'in',montant:R(1699.85),mode:'Cash'},
    {id:'MV002',date:'2026-05-12',lib:'Stock purchase - Invoice A-125',type:'out',montant:R(2300),mode:'Cash'},
    {id:'MV003',date:'2026-05-12',lib:'Sale TK-2026-00127',type:'in',montant:R(2300),mode:'Bank card'},
    {id:'MV004',date:'2026-05-12',lib:'Cash deposit to bank',type:'out',montant:R(5750),mode:'Bank transfer'},
    {id:'MV005',date:'2026-05-11',lib:'Sale TK-2026-00126',type:'in',montant:R(5750),mode:'Bank transfer'},
    {id:'MV006',date:'2026-05-11',lib:'Shop rent',type:'out',montant:R(4300),mode:'Bank transfer'},
  ],
  depenses:[
    {id:'D001',date:'2026-05-12',lib:'Goods purchase – Invoice A-125',cat:'Stock purchase',montant:R(2300),mode:'Cash'},
    {id:'D002',date:'2026-05-11',lib:'Shop rent',cat:'Rent',montant:R(4300),mode:'Bank transfer'},
    {id:'D003',date:'2026-05-10',lib:'Delivery to Soweto',cat:'Transport',montant:R(720),mode:'Cash'},
  ],
  employes:[
    {id:'E001',prenom:'Lerato',nom:'Dlamini',poste:'Cashier',salaire:R(5500),tel:'+27 72 111 2233',date:'2023-03-01',pres:98},
    {id:'E002',prenom:'Themba',nom:'Nkosi',poste:'Storekeeper',salaire:R(5200),tel:'+27 72 444 5566',date:'2022-07-15',pres:95},
    {id:'E003',prenom:'Zanele',nom:'Mthembu',poste:'Sales assistant',salaire:R(4800),tel:'+27 83 777 8899',date:'2024-01-10',pres:92},
    {id:'E004',prenom:'Pieter',nom:'van der Merwe',poste:'Accountant',salaire:R(9500),tel:'+27 82 321 0011',date:'2021-11-01',pres:100},
    {id:'E005',prenom:'Ayanda',nom:'Zulu',poste:'Sales assistant',salaire:R(4800),tel:'+27 83 654 3210',date:'2024-06-01',pres:88},
    {id:'E006',prenom:'Sibusiso',nom:'Mahlangu',poste:'Delivery driver',salaire:R(4500),tel:'+27 71 876 5432',date:'2023-09-01',pres:90},
  ],
  pos_day:{count:0,ca:0,cash:0,mm:0},
  inventaires:[],
  reglements_clients:[],
  admin_notifications:[],
  conges:[],
  journal:[],
  commandes:[],
  achats:[],
  retours:[],
};

let db = JSON.parse(JSON.stringify(DEF));
let CU = null;
let cart = [];
let lc = {};
let curInv = -1;
let dashChart = null;
let rapportChart = null;

/* ════════════════ PERSISTENCE ════════════════ */
let _saveTimer=null;
function userStoreKey(){return CU?.username?STORE_KEY+'_'+CU.username:STORE_KEY;}
async function loadData(){
  let local=null;try{const raw=localStorage.getItem(userStoreKey())||(CU?.role==='admin'?localStorage.getItem(STORE_KEY):null);if(raw)local=JSON.parse(raw);}catch(_){}
  if(!API_TOKEN){if(local)db={...DEF,...local};return;}
  try{const result=await apiCall('GET','/state');STATE_VERSION=Number(result.version)||0;if(result.state)db=mergeServerState(result.state);else if(local&&CU?.role==='admin'){db={...DEF,...local};await persistServer();}}
  catch(e){if(local)db={...DEF,...local};toast(e.message,'amber');}
}
function mergeServerState(state){
  if(CU?.role==='admin')return {...DEF,...state,settings:{...DEF.settings,...(state.settings||{})}};
  const base={...DEF,settings:{...DEF.settings},clients:[],produits:[],fournisseurs:[],factures:[],mouvements:[],depenses:[],employes:[],inventaires:[],reglements_clients:[],admin_notifications:[],conges:[],journal:[],commandes:[],retours:[]};
  return {...base,...state,settings:{...base.settings,...(state.settings||{})}};
}
function safeState(){const state=JSON.parse(JSON.stringify(db));if(state.settings)delete state.settings.users;return state;}
async function persistServer(){
  if(!API_TOKEN)return;
  try{const result=await apiCall('PUT','/state',{state:safeState(),base_version:STATE_VERSION});STATE_VERSION=Number(result.version)||STATE_VERSION;}
  catch(e){toast((e.code==='STATE_CONFLICT'?'Sync conflict: refresh the page. ':'Could not save to server: ')+e.message,'red');}
}
function saveAll(){try{localStorage.setItem(userStoreKey(),JSON.stringify(safeState()));}catch(_){}clearTimeout(_saveTimer);_saveTimer=setTimeout(persistServer,500);}
setInterval(saveAll,30000);
if(window.kintaAPI){window.kintaAPI.loadData().then(d=>{if(d)db={...DEF,...d};}).catch(()=>{});}

/* ════════════════ HELPERS ════════════════ */
const fmt = n => Math.round(n).toLocaleString(LOCALE);
const appNow = () => new Date(Date.now()+TEST_CLOCK_OFFSET_MS);
const today = () => appNow().toISOString().split('T')[0];
const now = () => appNow().toLocaleString(LOCALE);
const uid = () => Math.random().toString(36).slice(2,8).toUpperCase();
const g = id => document.getElementById(id);
const gv = id => {const e=g(id);if(!e)return '';return isMoneyInput(id)&&e.value!==''?String(toBase(parseFloat(e.value)||0)):e.value;};
const sg = (id,v) => {const e=g(id);if(e)e.textContent=v;};
const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
// Displays a date stored as YYYY-MM-DD in DD/MM/YYYY form (any time part is kept). Storage is unchanged.
const fmtDate = value => {const text=String(value ?? '');const m=/^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(text);return m?`${m[3]}/${m[2]}/${m[1]}${m[4].replace(/^T/,' ')}`:text;};
// Line icon from the sprite declared in index.html (#i-…).
const icon = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
// Product badge: initial + stable colour derived from the name.
const AVATAR_COLORS = [['#dcfce7','#166534'],['#dbeafe','#1e40af'],['#fef3c7','#92400e'],['#fce7f3','#9d174d'],['#ede9fe','#5b21b6'],['#cffafe','#155e75'],['#ffedd5','#9a3412'],['#e0e7ff','#3730a3'],['#f1f5f9','#334155'],['#ecfccb','#3f6212']];
function productAvatar(name,extraClass=''){
  const text=String(name||'').trim();let hash=0;for(const ch of text.toLocaleLowerCase(LOCALE))hash=(hash*31+ch.codePointAt(0))>>>0;
  const [bg,fg]=AVATAR_COLORS[hash%AVATAR_COLORS.length],initial=(text.match(/[\p{L}\p{N}]/u)?.[0]||'?').toLocaleUpperCase('fr');
  return `<span class="prod-avatar${extraClass?' '+extraClass:''}" style="background:${bg};color:${fg}" aria-hidden="true">${esc(initial)}</span>`;
}

/* ════════════════ AUTH ════════════════ */
let curRole = 'admin';
function selRole(r,btn){curRole=r;document.querySelectorAll('.auth-role').forEach(b=>b.classList.remove('on'));btn.classList.add('on');}
function login(){
  const u=gv('auth-user').trim(), p=gv('auth-pass');
  const err=g('auth-err');
  const user=USERS[u];
  if(!user||user.pass!==p){
    err.style.display='block';
    const inp=g('auth-user');if(inp){inp.style.borderColor='#ef4444';setTimeout(()=>inp.style.borderColor='',1500);}
    return;
  }
  err.style.display='none';
  CU={username:u,...user};
  g('auth-screen').style.display='none';
  g('app').style.display='flex';
  initApp();
}
function doLogout(){confirmDo('Sign out?',()=>{saveAll();API_TOKEN='';sessionStorage.removeItem(TOKEN_KEY);CU=null;location.reload();});}
async function registerBoutique(){
  const boutique_nom=gv('reg-shop-name').trim(),admin_login=gv('reg-admin-login').trim(),admin_password=gv('reg-admin-password'),button=g('reg-submit');
  if(!boutique_nom||!admin_login||admin_password.length<8){toast('Name, username and a password of at least 8 characters are required','red');return;}
  if(button)button.disabled=true;
  try{
    const result=await apiCall('POST','/auth/register',{boutique_nom,boutique_adresse:gv('reg-shop-address').trim(),boutique_ville:gv('reg-shop-city').trim(),admin_login,admin_password,admin_nom:gv('reg-admin-name').trim()});
    API_TOKEN=result.token;sessionStorage.setItem(TOKEN_KEY,API_TOKEN);const user=result.user;
    CU={id:user.id,username:user.login,role:user.role,label:user.nom||user.login,initials:(user.nom||user.login||'U')[0].toUpperCase()};
    closeM('m-register-shop');g('auth-screen').style.display='none';g('app').style.display='flex';resetSessionTimer();await initApp();showWelcome(boutique_nom);toast('Shop created successfully','green');
  }catch(e){toast(e.message,'red');}finally{if(button)button.disabled=false;}
}
const isLocalHost = () => ['localhost','127.0.0.1'].includes(location.hostname);
async function configureAuthScreen(){
  const hint=g('development-login-hint');if(hint)hint.hidden=!isLocalHost();
  try{const config=await apiCall('GET','/auth/config');TEST_CLOCK_ENABLED=!!config.test_clock_enabled;if(g('register-shop-button'))g('register-shop-button').style.display=config.registration_enabled?'flex':'none';}catch(_){}
}
function showWelcome(shopName){sg('welcome-shop-name',shopName||'your shop');g('welcome-shop')?.classList.add('open');}
function closeWelcome(){g('welcome-shop')?.classList.remove('open');}
function openHelpCenter(){openM('m-help');}
function welcomeGo(page){
  closeWelcome();
  const target=page==='utilisateurs'?'parametres':page,item=document.querySelector(`.sb-item[data-p="${target}"]`);
  nav(target,item);
  if(page==='parametres')setTimeout(()=>{g('p-tel')?.scrollIntoView({behavior:'smooth',block:'center'});g('p-tel')?.focus();},160);
  if(page==='produits')setTimeout(()=>{openM('m-prod');updateSubcategories();},120);
  if(page==='utilisateurs')setTimeout(()=>openM('m-user'),120);
}

function setupSteps(){
  const settings=db.settings||{},users=getUsers(),products=db.produits||[],sales=db.factures||[];
  return [
    {title:'Complete shop details',desc:'Address, phone and legal details',done:!!String(settings.adresse||'').trim()&&!!String(settings.tel||'').trim(),page:'parametres'},
    {title:'Add a product',desc:'Cost price, selling price and opening stock',done:products.length>0,page:'produits'},
    {title:'Create your team',desc:'Add at least one account besides yours',done:users.length>1,page:'utilisateurs'},
    {title:'Make a test sale',desc:'Test the till and check the receipt',done:sales.length>0,page:'caisse'}
  ];
}
function renderSetupGuide(){
  const list=g('setup-list'),guide=g('setup-guide');if(!list||!guide)return;
  const steps=setupSteps(),completed=steps.filter(step=>step.done).length,percent=Math.round(completed/steps.length*100);
  guide.hidden=completed===steps.length;
  guide.style.display=completed===steps.length?'none':'';
  if(completed===steps.length)return;
  list.innerHTML=steps.map((step,index)=>`<button type="button" class="setup-item ${step.done?'done':''}" onclick="welcomeGo('${step.page}')"><span class="setup-item-top"><span class="setup-item-num">STEP ${index+1}</span><span class="setup-check">${step.done?'✓':'→'}</span></span><strong>${step.title}</strong><span class="setup-item-desc">${step.done?'Done — click to edit':step.desc}</span></button>`).join('');
  sg('setup-percent',percent+'%');sg('setup-count',completed+' of '+steps.length+' steps');
  const bar=g('setup-progress-bar');if(bar)bar.style.width=percent+'%';
  const message=g('setup-guide-message');if(message)message.textContent='Follow these steps in order. Kinta tracks your progress automatically.';
  const next=g('setup-next'),nextStep=steps.find(step=>!step.done);if(next){next.textContent=nextStep?'Continue: '+nextStep.title:'Setup complete ✓';next.disabled=!nextStep;}
}
function startNextSetupStep(){const next=setupSteps().find(step=>!step.done);if(next)welcomeGo(next.page);else toast('Your setup is complete ✓','green');}

/* ── SESSION TIMEOUT 60 min ── */
let _sessionTimer = null;
function resetSessionTimer(){
  clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(()=>{
    if(CU){
      saveAll();
      toast('Session expired — sign in again','amber');
      setTimeout(()=>{CU=null;location.reload();},2000);
    }
  }, 60*60*1000);
}
['mousemove','keydown','click','touchstart'].forEach(ev=>
  document.addEventListener(ev, resetSessionTimer, {passive:true})
);

/* ════════════════ INIT ════════════════ */
async function initApp(){
  await loadData();
  // Topbar user
  sg('tb-uname',CU.label);sg('tb-ua',CU.initials);sg('tb-shop',db.settings?.nom||'Shop');
  sg('sb-uname',CU.username);sg('sb-urole',CU.label);sg('sb-av',CU.initials);
  // Date
  g('tb-date').textContent=appNow().toLocaleDateString(LOCALE,{day:'numeric',month:'long',year:'numeric'});
  // Params
  loadSettings();
  // Cat filters
  buildCats();
  buildPOS();
  updateAdminNotificationBell();
  // Render dashboard
  renderDash();
  // Keyboard shortcut
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveAll();toast('Data saved','green');}if(e.key==='Escape')document.querySelectorAll('.modal-overlay.open,.confirm-wrap.open').forEach(m=>m.classList.remove('open'));});
  document.addEventListener('click',e=>{if(!g('notification-wrap')?.contains(e.target))g('notification-panel')?.classList.remove('open');});
  // Electron
  if(window.kintaAPI){window.kintaAPI.onTriggerSave&&window.kintaAPI.onTriggerSave(()=>{saveAll();toast('Saved','green');});}
  toast('Welcome to Kinta ERP, '+CU.label+' !','green');
}

/* ════════════════ NAVIGATION ════════════════ */
const PAGE_TITLES = {
  dashboard:'Dashboard',caisse:'Till (POS)',ventes:'Sales',produits:'Products & Stock',
  achats:'Stock purchases',
  stock:'Products & Stock',clients:'Customers',tresorerie:'Treasury',depenses:'Treasury',
  rapports:'Reports','autres-rapports':'Reports',employes:'Employees',utilisateurs:'Users',
  fournisseurs:'Suppliers',retours:'Returns',comptabilite:'Accounting',
  controle:'Control & backup',parametres:'Settings',
  messagerie:'Messages',
};

const ROLE_ACCESS = Object.freeze({
  admin: Object.freeze(['dashboard','caisse','ventes','produits','achats','clients','tresorerie','depenses','rapports','autres-rapports','employes','utilisateurs','fournisseurs','retours','comptabilite','controle','parametres','messagerie']),
  cashier: Object.freeze(['caisse','ventes','messagerie']),
  salesperson: Object.freeze(['dashboard','produits','clients']),
  accountant: Object.freeze(['comptabilite','messagerie']),
});
function canAccessPage(page){
  const normalized=page==='stock'?'produits':page;
  return !!CU&&!!ROLE_ACCESS[CU.role]?.includes(normalized);
}
function applyRolePermissions(){
  document.body.dataset.role=CU?.role||'';
  const messageButton=document.querySelector('.tb-message');if(messageButton)messageButton.hidden=!canAccessPage('messagerie');
  document.querySelectorAll('.sb-item[data-p]').forEach(item=>{
    item.hidden=!canAccessPage(item.dataset.p);
    item.setAttribute('aria-hidden',String(item.hidden));
  });
  document.querySelectorAll('.sb-sec').forEach(section=>{
    let next=section.nextElementSibling,hasVisible=false;
    while(next&&!next.classList.contains('sb-sec')){if(next.classList.contains('sb-item')&&!next.hidden)hasVisible=true;next=next.nextElementSibling;}
    section.hidden=!hasVisible;
  });
}

/* Single registry of page renderers. Functions are resolved at click time so
   that the extended versions declared further down the file are used. */
const PAGE_RENDERERS = {
  dashboard:()=>renderDash(),
  caisse:()=>buildPOS(),
  ventes:()=>renderSales(),
  produits:()=>{renderProducts();renderStock();},
  achats:()=>renderPurchases(),
  clients:()=>renderCustomers(),
  tresorerie:()=>renderTreasury(),
  depenses:()=>renderExpenses(),
  rapports:()=>renderReports(),
  'autres-rapports':()=>{},
  employes:()=>renderEmployees(),
  fournisseurs:()=>renderSuppliers(),
  retours:()=>renderReturns(),
  comptabilite:()=>{renderAccounting();renderBalance();renderGeneralLedger();renderTVA();renderBalanceSheetV62();},
  controle:()=>renderControl(),
  parametres:()=>loadSettings(),
  messagerie:()=>loadMessenger(),
};
function nav(p,el){
  if(!canAccessPage(p)){toast('Access not allowed for role '+(CU?.label||CU?.role||''),'red');return false;}
  const stockRoute=p==='stock';
  if(stockRoute){p='produits';el=document.querySelector('.sb-item[data-p="produits"]');}
  const pg=g('page-'+p);
  if(!pg){toast('Page not found: '+(PAGE_TITLES[p]||p),'red');return;}
  document.querySelectorAll('.page').forEach(pg=>pg.classList.remove('on'));
  document.querySelectorAll('.sb-item').forEach(n=>n.classList.remove('on'));
  pg.classList.add('on');
  const activeItem=el||document.querySelector('.sb-item[data-p="'+p+'"]');
  if(activeItem)activeItem.classList.add('on');
  sg('pg-title',PAGE_TITLES[p]||p);
  const render=PAGE_RENDERERS[p];
  if(render){
    try{render();}
    catch(err){console.error('Render error for '+p,err);toast('Could not load '+(PAGE_TITLES[p]||p),'red');}
  }
  if(stockRoute)switchProductTab('stock');
  if(window.innerWidth<900)document.body.classList.remove('sidebar-open');
  return true;
}

/* ════════════════ DASHBOARD ════════════════ */
function renderDash(){
  renderSetupGuide();updateKPIs();updateAlerts();updateSummary();renderActList();
  setTimeout(()=>renderDashChart(),80);
}
/* Metrics for one day (key YYYY-MM-DD) — same definitions as the Reports page:
   sales = non-cancelled invoices (credit included), profit = gross margin,
   receipts = the day's treasury inflows (paid sales + credit payments). */
function dayKey(offset=0){const d=new Date(today()+'T12:00:00');d.setDate(d.getDate()+offset);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function dayMetrics(key){
  const sales=salesMetrics((db.factures||[]).filter(f=>f.date===key&&f.statut!=='Cancelled'));
  const enc=(db.mouvements||[]).filter(m=>m.type==='in'&&m.date===key).reduce((sum,m)=>sum+(Number(m.montant)||0),0);
  return {ventes:sales.total,enc,benef:sales.benef,count:sales.count};
}
function setKPITrend(id,current,previous){
  const el=g(id);if(!el)return;
  if(!previous){el.className='kpi-trend t-flat';el.textContent='— vs yesterday';el.title='No data yesterday: comparison not possible';return;}
  const pct=Math.round((current-previous)/previous*100),dir=pct>0?'up':pct<0?'dn':'flat';
  const arrow=dir==='up'?'<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>':dir==='dn'?'<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>':'';
  el.className='kpi-trend t-'+dir;el.title='Yesterday: '+money(previous);
  el.innerHTML=(arrow?`<svg viewBox="0 0 24 24">${arrow}</svg>`:'')+(pct>0?'+':'')+pct+'&nbsp;% vs yesterday';
}
function setKPIAmount(id,value){const el=g(id);if(!el)return;const unit='<span class="unit">'+esc(curSym())+'</span>';el.innerHTML=curBefore()?unit+'&nbsp;'+amt(value):amt(value)+'&nbsp;'+unit;}
function updateKPIs(){
  const cur=dayMetrics(dayKey(0)),prev=dayMetrics(dayKey(-1));
  const alerts=db.produits.filter(p=>p.stk===0||p.stk<=p.min).length;
  setKPIAmount('k-ca',cur.ventes);setKPIAmount('k-enc',cur.enc);setKPIAmount('k-benef',cur.benef);sg('k-trans',String(cur.count));
  setKPITrend('k-ca-trend',cur.ventes,prev.ventes);setKPITrend('k-enc-trend',cur.enc,prev.enc);
  setKPITrend('k-benef-trend',cur.benef,prev.benef);setKPITrend('k-trans-trend',cur.count,prev.count);
  sg('k-alerts',String(alerts));
  sg('badge-stk',String(alerts));
  updateAdminNotificationBell();
}
function updateAlerts(){
  const rupt=db.produits.filter(p=>p.stk===0).length;
  const low=db.produits.filter(p=>p.stk>0&&p.stk<=p.min).length;
  const att=db.factures.filter(f=>f.statut!=='Paid').length;
  const det=db.clients.filter(c=>c.solde>0).length;
  sg('aw-low',low+' product(s) affected');sg('aw-rupt',rupt+' product(s) out of stock');
  sg('aw-fac',att+' invoice(s) pending');sg('aw-dette',det+' customer(s) owe money');
}
function notifyAdminOfCashierSale(invoice){
  if(CU?.role!=='cashier'||!invoice)return;
  db.admin_notifications=db.admin_notifications||[];
  db.admin_notifications.unshift({id:'NOT'+uid(),type:'cashier_sale',createdAt:appNow().toISOString(),cashier:CU.username||CU.label,invoice:invoice.num,client:invoice.client||'Walk-in customer',amount:Number(invoice.montant)||0,read:false});
  db.admin_notifications=db.admin_notifications.slice(0,100);
}
function updateAdminNotificationBell(){
  const wrap=g('notification-wrap'),badge=g('notif-num');if(!wrap||!badge)return;
  const isAdmin=CU?.role==='admin';wrap.style.display=isAdmin?'block':'none';
  if(!isAdmin)return;
  const unread=(db.admin_notifications||[]).filter(n=>!n.read).length;
  badge.textContent=unread>99?'99+':String(unread);badge.style.display=unread?'block':'none';
  renderAdminNotifications();
}
function renderAdminNotifications(){
  const list=g('notification-list');if(!list||CU?.role!=='admin')return;
  const items=(db.admin_notifications||[]).slice(0,50);
  list.innerHTML=items.map(n=>`<button type="button" class="notification-item${n.read?'':' unread'}" onclick="openAdminNotification('${n.id}')"><div class="notification-item-title">Sale collected by ${esc(n.cashier)}</div><div class="notification-item-detail">${esc(n.invoice)} · ${esc(n.client)} · ${money(n.amount)}</div><div class="notification-item-time">${new Date(n.createdAt).toLocaleString(LOCALE)}</div></button>`).join('')||'<div class="notification-empty">No notifications</div>';
}
function toggleAdminNotifications(event){
  event?.stopPropagation();if(CU?.role!=='admin')return;renderAdminNotifications();g('notification-panel')?.classList.toggle('open');
}
function openAdminNotification(id){
  const item=(db.admin_notifications||[]).find(n=>n.id===id);if(item)item.read=true;
  saveAll();updateAdminNotificationBell();g('notification-panel')?.classList.remove('open');nav('ventes',document.querySelector('.sb-item[data-p="ventes"]'));
}
function markAllAdminNotificationsRead(event){
  event?.stopPropagation();(db.admin_notifications||[]).forEach(n=>n.read=true);saveAll();updateAdminNotificationBell();
}
function updateSummary(){
  const val=db.produits.reduce((a,p)=>a+p.stk*p.pa,0);
  const nonEnc=db.factures.filter(f=>f.statut!=='Paid').reduce((a,f)=>a+f.montant,0);
  sg('s-prods',String(db.produits.length));sg('s-stk',money(val));
  sg('s-cli',String(db.clients.length));sg('s-fourn',String(db.fournisseurs.length));sg('s-emp',String(db.employes.length));
  const sales={};db.factures.filter(f=>f.statut!=='Cancelled').forEach(f=>(f.lignes||[]).forEach(l=>{const name=l.d||l.desc||'Item',qty=Number(l.q||l.qte)||0,total=Number(l.t)||qty*Number(l.pu||0);sales[name]=sales[name]||{qty:0,total:0};sales[name].qty+=qty;sales[name].total+=total;}));
  const top=Object.entries(sales).sort((a,b)=>b[1].qty-a[1].qty).slice(0,4),el=g('top-prods');
  if(el)el.innerHTML=top.map(([name,v],i)=>`<div class="tp-row"${i===top.length-1?' style="border:none"':''}><div class="tp-rank">${i+1}</div><div class="tp-name">${esc(name)}</div><div class="tp-qty">${fmt(v.qty)} units</div><div class="tp-amt">${money(v.total)}</div></div>`).join('')||'<div style="color:#94a3b8;font-size:13px;padding:12px">No sales recorded</div>';
}
function renderActList(){
  const el=g('act-list');if(!el)return;
  const acts=(db.mouvements||[]).slice(0,6).map(m=>({bg:m.type==='out'?'#fef2f2':m.type==='transfer'?'#eff6ff':'#f0fdf4',sc:m.type==='out'?'#ef4444':m.type==='transfer'?'#3b82f6':'#16a34a',icon:m.type==='transfer'?'M3 7h15m-4-4 4-4M21 17H6m4 4-4-4 4-4':m.type==='out'?'M12 2v20M8 6l4-4 4 4':'M12 2v20M8 18l4 4 4-4',title:m.type==='out'?'Cash outflow':m.type==='transfer'?'Transfer':'Receipt',sub:(m.lib||'Transaction')+' · '+money(Number(m.montant)||0),time:fmtDate(m.date)}));
  el.innerHTML=acts.map(a=>`<div class="act-item"><div class="act-ic" style="background:${a.bg}"><svg viewBox="0 0 24 24" style="stroke:${a.sc};fill:none;width:14px;height:14px;stroke-width:2"><path d="${a.icon}" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div style="flex:1"><div class="act-title">${a.title}</div><div class="act-sub">${esc(a.sub)}</div></div><div class="act-time">${esc(a.time)}</div></div>`).join('')||'<div style="color:#94a3b8;font-size:13px;padding:16px">No activity recorded</div>';
}
const CHART_D={
  m:['Jan','Feb','Mar','Apr','May'],
  v:[500000,780000,510000,650000,750000],
  p:[450000,530000,560000,550000,620000],
};
function renderDashChart(){
  if(dashChart){dashChart.destroy();dashChart=null;}
  const cv=g('dash-chart');if(!cv)return;
  const months=[];for(let offset=5;offset>=0;offset--){const d=appNow();d.setMonth(d.getMonth()-offset,1);months.push({key:d.toISOString().slice(0,7),label:d.toLocaleDateString(LOCALE,{month:'short'})});}
  const values=months.map(m=>db.factures.filter(f=>f.statut!=='Cancelled'&&String(f.date||'').startsWith(m.key)).reduce((sum,f)=>sum+Number(f.montant||0),0));
  dashChart=new Chart(cv.getContext('2d'),{type:'bar',data:{labels:months.map(m=>m.label),datasets:[{label:'Sales',data:values,backgroundColor:'#16a34a',borderRadius:4,barPercentage:.55,categoryPercentage:.7}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#fff',borderColor:'#e2e8f0',borderWidth:1,titleColor:'#374151',bodyColor:'#374151',padding:10,callbacks:{label:c=>'Sales: '+money(c.raw)}}},scales:{x:{grid:{display:false},ticks:{color:'#94a3b8',font:{size:11,family:'Inter'}}},y:{beginAtZero:true,grid:{color:'#f1f5f9',lineWidth:1},ticks:{color:'#94a3b8',font:{size:11,family:'Inter'},callback:v=>{v=fromBase(v);return v>=1000000?fmt(v/1000000)+'M':v>=1000?fmt(v/1000)+'K':fmt(v);}}}}}});
}
function renderReports(){
  if(rapportChart){rapportChart.destroy();rapportChart=null;}
  const cv=g('rapport-chart');if(!cv)return;
  rapportChart=new Chart(cv.getContext('2d'),{type:'bar',data:{labels:['Jan','Feb','Mar','Apr','May'],datasets:[
    {label:'May 2026',data:[500000,780000,510000,650000,750000],backgroundColor:'#16a34a',borderRadius:4,barPercentage:.55,categoryPercentage:.7},
    {label:'April 2026',data:[450000,530000,560000,550000,620000],backgroundColor:'#d1d5db',borderRadius:4,barPercentage:.55,categoryPercentage:.7},
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#374151',font:{size:12,family:'Inter'},boxWidth:10}},tooltip:{backgroundColor:'#fff',borderColor:'#e2e8f0',borderWidth:1,titleColor:'#374151',bodyColor:'#374151',padding:10,callbacks:{label:c=>c.dataset.label+': '+money(c.raw)}}},scales:{x:{grid:{display:false},ticks:{color:'#94a3b8',font:{size:11,family:'Inter'}}},y:{grid:{color:'#f1f5f9'},border:{dash:[3,3]},ticks:{color:'#94a3b8',font:{size:11,family:'Inter'},callback:v=>{v=fromBase(v);return v>=1000000?fmt(v/1000000)+'M':v>=1000?fmt(v/1000)+'K':fmt(v);}}}}}});
}
function setPeriod(p,btn){document.querySelectorAll('.ptab').forEach(b=>b.classList.remove('on'));btn.classList.add('on');}

/* ════════════════ SALES ════════════════ */
function renderSales(){
  const facs=db.factures;
  const paid=facs.filter(f=>f.statut==='Paid');
  const att=facs.filter(f=>f.statut!=='Paid'&&f.statut!=='Cancelled');
  const ann=facs.filter(f=>f.statut==='Cancelled');
  sg('v-tot',amt(facs.filter(f=>f.statut!=='Cancelled').reduce((a,f)=>a+f.montant,0)));sg('v-nb',String(facs.length));
  sg('v-att',String(att.length));sg('v-att-a',money(att.reduce((a,f)=>a+f.montant,0)));
  sg('v-paid',String(paid.length));sg('v-paid-a',money(paid.reduce((a,f)=>a+f.montant,0)));
  const rows=facs.map((f,i)=>`<tr style="opacity:${f.statut==='Cancelled'?'.5':'1'}">
    <td class="mono">${esc(fmtDate(f.date))}</td>
    <td class="bold mono">${esc(f.num)}</td>
    <td>${esc(f.caissier||f.caissier_nom||'Not specified')}</td>
    <td class="mono" style="font-weight:600;color:${f.statut==='Cancelled'?'#ef4444':'inherit'}">${money(f.montant)}</td>
    <td><div style="display:flex;align-items:center;gap:5px;font-size:12px">
      <span style="width:8px;height:8px;border-radius:50%;background:${f.mode==='Cash'?'#16a34a':f.mode&&f.mode.includes('E-wallet')?'#f59e0b':'#3b82f6'};display:inline-block"></span>
      ${esc(f.mode||'—')}
    </div></td>
    <td><span class="badge ${f.statut==='Paid'?'b-green':f.statut==='Cancelled'?'b-red':'b-amber'}">${esc(f.statut)}</span></td>
    <td><div style="display:flex;gap:5px">
      <button class="btn btn-outline btn-xs" onclick="previewInv(${i})" title="View sale" aria-label="View sale">${icon('eye')}</button>
      <button class="btn-icon" onclick="previewInv(${i})" title="Print" aria-label="Print">${icon('printer')}</button>
      ${f.statut==='Pending'?`<button class="btn btn-success btn-xs" onclick="markInvoicePaid(${i})">✓ Mark as paid</button>`:''}
      ${f.statut!=='Cancelled'?`<button class="btn btn-danger btn-xs" onclick="cancelSale(${i})">✕ Cancel</button>`:''}
    </div></td>
  </tr>`);
  setTimeout(()=>makeSortable('t-ventes'),50);renderPaginatedTable('t-ventes', rows, 'No sales recorded', 7);
}

function markInvoicePaid(i){
  db.factures[i].statut='Paid';
  db.mouvements.unshift({id:'MV'+uid(),date:today(),lib:'Receipt '+db.factures[i].num,type:'in',montant:db.factures[i].montant,mode:'Cash'});
  notifyAdminOfCashierSale(db.factures[i]);
  renderSales();renderTreasury();updateKPIs();updateAlerts();saveAll();confetti();
  toast('Sale collected — '+money(db.factures[i].montant),'green');
}
function previewInv(i){
  const f=db.factures[i];const s=db.settings;
  const tva=s.tva||18;const ht=Math.round(f.montant/(1+tva/100));const tvaA=f.montant-ht;
  const rows=(f.lignes||[]).map(l=>`<tr><td>${esc(l.d)}</td><td style="text-align:center">${esc(l.q)}</td><td style="text-align:right">${amt(l.pu)}</td><td style="text-align:right">${amt(l.t)}</td></tr>`).join('')||`<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:12px">Details not available</td></tr>`;
  g('inv-content').innerHTML=`<div class="inv-preview" id="printable-inv">
    <div class="inv-hdr"><div><div class="inv-co">${esc(s.nom)}</div><div style="color:#64748b;font-size:12px;margin-top:4px">${esc(s.adresse)}</div><div style="color:#64748b;font-size:12px">${esc(s.tel)}</div>${s.rccm?`<div style="color:#9ca3af;font-size:11px;margin-top:3px">Reg. no.: ${esc(s.rccm)}${s.niu?' · VAT no.: '+esc(s.niu):''}</div>`:''}</div>
    <div style="text-align:right"><div class="inv-num-big">${esc(f.num)}</div><span class="inv-badge ${f.statut==='Paid'?'inv-paid':'inv-pend'}">${esc(f.statut)}</span><div style="font-size:12px;color:#64748b;margin-top:6px">Date: ${esc(fmtDate(f.date))}</div>${f.ech?`<div style="font-size:12px;color:#64748b">Due: ${esc(fmtDate(f.ech))}</div>`:''}</div></div>
    <div style="background:#f8fafc;border-radius:8px;padding:12px 14px;margin-bottom:14px"><div style="font-size:11px;color:#9ca3af;margin-bottom:2px">BILLED TO</div><div style="font-size:15px;font-weight:700">${esc(f.client)}</div></div>
    <table class="inv-table"><thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Total excl. tax</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="margin-top:12px;text-align:right"><div style="font-size:12px;color:#64748b;margin-bottom:3px">Subtotal excl. VAT: ${money(ht)}</div><div style="font-size:12px;color:#64748b;margin-bottom:6px">VAT ${tva}% : ${money(tvaA)}</div></div>
    <div class="inv-total-bar"><span>TOTAL INCL. TAX</span><span>${money(f.montant)}</span></div>
    ${s.mentions?`<div class="inv-footer-txt">${esc(s.mentions)}</div>`:''}
  </div>`;
  curInv=i;openM('m-inv');
}
function doPrint(){const h=g('printable-inv')?.outerHTML||'';const full=`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Inter,sans-serif;padding:32px;margin:0}${Array.from(document.styleSheets).filter(s=>{try{return s.cssRules;}catch(e){return false;}}).map(s=>Array.from(s.cssRules).map(r=>r.cssText).join('\n')).join('\n')}</style></head><body>${h}</body></html>`;if(window.kintaAPI)window.kintaAPI.printInvoice(full);else{const w=window.open('','_blank');w.document.write(full);w.document.close();w.print();}}
async function doPDF(){if(window.kintaAPI){const h=g('printable-inv')?.outerHTML||'';await window.kintaAPI.exportPDF(h,db.factures[curInv]?.num||'facture');toast('PDF exported','green');}else{toast('Choose "Save as PDF" in the print window','blue');doPrint();}}

/* ════════════════ PRODUCTS ════════════════ */
let currentProductTab='catalogue';
function openProductModule(tab='catalogue'){
  nav('produits',document.querySelector('.sb-item[data-p="produits"]'));
  switchProductTab(tab);
}
function switchProductTab(tab){
  const tabs=['catalogue','stock','inventaires'];
  if(!tabs.includes(tab))tab='catalogue';
  currentProductTab=tab;
  tabs.forEach(name=>{
    const btn=g('product-tab-'+name),content=g('product-content-'+name);
    if(btn)btn.classList.toggle('on',name===tab);
    if(content)content.style.display=name===tab?'':'none';
  });
  if(tab==='catalogue')renderProducts();
  else if(tab==='stock')renderStock();
  else renderInventories();
}
function buildProductMovements(){
  const movements=[];
  (db.commandes||[]).filter(c=>c.statut==='Received').forEach(c=>(c.lignes||[]).forEach(l=>movements.push({date:c.reception||c.date,product:l.d,type:'In',qty:Number(l.q)||0,ref:c.facture||c.num})));
  (db.factures||[]).filter(f=>f.statut==='Paid').forEach(f=>(f.lignes||[]).forEach(l=>movements.push({date:f.date,product:l.d||l.desc||'Product',type:'Out',qty:-(Number(l.q||l.qte)||0),ref:f.num})));
  return movements.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function renderProductMovements(){
  const rows=buildProductMovements();
  const tbody=g('t-product-movements');if(!tbody)return;
  tbody.innerHTML=rows.map(m=>`<tr><td class="mono">${esc(fmtDate(m.date)||'—')}</td><td class="bold">${esc(m.product)}</td><td><span class="badge ${m.type==='In'?'b-green':'b-red'}">${m.type}</span></td><td class="mono" style="font-weight:700;color:${m.qty>=0?'#16a34a':'#ef4444'}">${m.qty>0?'+':''}${m.qty}</td><td class="mono">${esc(m.ref||'—')}</td></tr>`).join('')||emptyR(5,'No movements recorded');
}
function renderInventories(){
  const tbody=g('t-inventaires');if(!tbody)return;
  tbody.innerHTML=(db.inventaires||[]).map(inv=>`<tr><td class="mono">${esc(fmtDate(inv.date))}</td><td class="mono bold">${esc(inv.ref)}</td><td>${esc(inv.user)}</td><td>${inv.articles}</td><td class="mono">${money(inv.value)}</td><td><span class="badge ${inv.ecarts?'b-amber':'b-green'}">${inv.ecarts||0}</span></td></tr>`).join('')||emptyR(6,'No stock count yet');
}
function createInventorySnapshot(){
  confirmDo('Create a snapshot of the current stock?',()=>{
    db.inventaires=db.inventaires||[];
    db.inventaires.unshift({id:'INV'+uid(),ref:'INV-'+today().replace(/-/g,'')+'-'+String(db.inventaires.length+1).padStart(3,'0'),date:now(),user:CU?.label||'User',articles:db.produits.length,value:db.produits.reduce((sum,p)=>sum+(Number(p.stk)||0)*(Number(p.pa)||0),0),ecarts:0});
    saveAll();renderInventories();toast('Stock count saved','green');
  });
}
function renderProducts(){
  const cats=[...new Set(db.produits.map(p=>p.cat))];
  const cf=g('pcat-f');if(cf)cf.innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option>${c}</option>`).join('');
  const rows=db.produits.map((p,i)=>{
    const st=p.stk===0?['Out of stock','b-rupt']:p.stk<=p.min?['Low stock','b-low']:['In stock','b-ok'];
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">${productAvatar(p.nom)}<span class="bold">${esc(p.nom)}</span></div></td>
      <td><span class="badge b-gray">${esc(p.cat)}</span></td>
      <td style="font-weight:700;color:${p.stk===0?'#ef4444':p.stk<=p.min?'#f59e0b':'#16a34a'}">${fmt(p.stk)}</td>
      <td>${p.min}</td>
      <td class="mono">${money(p.pa)}</td>
      <td class="mono">${money(p.stk*p.pa)}</td>
      <td><span class="badge ${st[1]}">${st[0]}</span></td>
      <td><div style="display:flex;gap:5px">
        <button class="btn btn-outline btn-xs" onclick="adjustStock(${i})">${icon('edit')} Edit</button>
        <button class="btn btn-outline btn-xs" onclick="renameProduct(${i})">Rename</button>
        <button class="btn btn-outline btn-xs" onclick="showProductHistory(${i})" title="Movement history" aria-label="Movement history">${icon('list')}</button>
      </div></td>
    </tr>`;
  });
  setTimeout(()=>makeSortable('t-prods'),50);renderPaginatedTable('t-prods',rows,'No products',8);
}/* ════════════════ STOCK ════════════════ */
function renderStock(){
  const rupt=db.produits.filter(p=>p.stk===0).length;
  const low=db.produits.filter(p=>p.stk>0&&p.stk<=p.min).length;
  const val=db.produits.reduce((a,p)=>a+p.stk*p.pa,0);
  sg('sk-val',money(val));sg('sk-sub',db.produits.length+' products in stock');
  sg('sk-low',String(low));sg('sk-rupt',String(rupt));
  sg('sk-mvt',String(buildProductMovements().length));
  const cats=[...new Set(db.produits.map(p=>p.cat))];
  const cf=g('scat-f');if(cf)cf.innerHTML='<option value="">All</option>'+cats.map(c=>`<option>${c}</option>`).join('');
  g('t-stock').innerHTML=db.produits.map((p,i)=>{
    const st=p.stk===0?['Out of stock','b-rupt']:p.stk<=p.min?['Low stock','b-low']:['In stock','b-ok'];
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">${productAvatar(p.nom)}<span class="bold">${esc(p.nom)}</span></div></td>
      <td><span class="badge b-gray">${esc(p.cat)}</span></td>
      <td style="font-weight:700;color:${p.stk===0?'#ef4444':p.stk<=p.min?'#f59e0b':'#16a34a'}">${fmt(p.stk)}</td>
      <td>${p.min}</td>
      <td class="mono">${money(p.pa)}</td>
      <td class="mono">${money(p.stk*p.pa)}</td>
      <td><span class="badge ${st[1]}">${st[0]}</span></td>
      <td><div style="display:flex;gap:5px">
        <button class="btn btn-outline btn-xs" onclick="adjustStock(${i})">${icon('edit')} Edit</button>
        <button class="btn btn-outline btn-xs" onclick="renameProduct(${i})">Rename</button>
        <button class="btn btn-outline btn-xs" onclick="showProductHistory(${i})" title="Movement history" aria-label="Movement history">${icon('list')}</button>
      </div></td>
    </tr>`;
  }).join('')||emptyR(8);
}
// CSV categories may be typed in English ("Food"): store the internal category key.
function categoryKey(name){const n=String(name||'').trim();if(!n)return '';return Object.keys(CATS).find(k=>k.toLowerCase()===n.toLowerCase())||n;}
function renameProduct(i){const p=db.produits[i];const name=prompt(`Rename "${p.nom}"`,p.nom);if(name===null||!name.trim()||name.trim()===p.nom)return;p.nom=name.trim();renderProducts();renderStock();buildPOS();saveAll();toast('Product renamed','green');}
function adjustStock(i){const p=db.produits[i];const d=parseInt(prompt(`Adjust stock "${p.nom}" (current: ${p.stk})\n+X to add, -X to remove`,'0'));if(isNaN(d)||d===0)return;db.produits[i].stk=Math.max(0,p.stk+d);renderStock();renderProducts();updateKPIs();updateAlerts();saveAll();toast('Stock updated','green');}
function filterStockStatus(s){g('t-stock')?.querySelectorAll('tr').forEach(row=>{if(!s){row.style.display='';return;}const b=row.querySelector('.badge');const t=b?b.textContent.toLowerCase():'';row.style.display=(s==='out'&&t.includes('out of stock'))||(s==='low'&&t.includes('low stock'))||(s==='ok'&&t.includes('in stock'))?'':'none';});}

/* ════════════════ CLIENTS ════════════════ */
function renderCustomers(){
  const cliRows=db.clients.map((c,i)=>{
    const pct=c.credit>0?Math.min(100,Math.round(c.solde/c.credit*100)):0;
    const pc=pct>=80?'#ef4444':pct>=50?'#f59e0b':'#16a34a';
    return `<tr>
      <td class="bold">${esc(c.nom)}</td><td class="mono">${esc(c.tel)}</td><td>${esc(c.email||'—')}</td><td>${esc(c.ville)}</td>
      <td><span class="badge b-blue">${esc(c.type)}</span></td>
      <td class="mono" style="color:${c.solde>0?'#ef4444':'#64748b'}">${c.solde>0?money(c.solde):'—'}</td>
      <td><div style="min-width:90px"><div class="prog"><div class="prog-f" style="width:${pct}%;background:${pc}"></div></div><div style="font-size:10px;color:#94a3b8;margin-top:2px">${pct}% / ${money(c.credit)}</div></div></td>
      <td><div style="display:flex;gap:5px">
      <button class="btn btn-outline btn-xs" onclick="showClientHistory(${i})">${icon('list')} History</button>
      <button class="btn btn-danger btn-xs" onclick="confirmDo('Delete this customer?',()=>{db.clients.splice(${i},1);renderCustomers();saveAll();})">×</button>
    </div></td>
    </tr>`;
  });
  setTimeout(()=>makeSortable('t-cli'),50);renderPaginatedTable('t-cli',cliRows,'No customers',8);
}

/* ════════════════ TREASURY ════════════════ */
let tresoDonut = null;
function renderTreasury(){
  const enc=db.mouvements.filter(m=>m.type==='in').reduce((a,m)=>a+m.montant,0);
  const dec=db.mouvements.filter(m=>m.type==='out').reduce((a,m)=>a+m.montant,0);
  const sol=enc-dec;
  sg('tr-solde',money(sol));sg('tr-enc',money(enc));sg('tr-dec',money(dec));sg('tr-dispo',money(sol));
  sg('tr-enc2',money(enc));sg('tr-dec2',money(dec));sg('tr-solde2',money(sol));
  sg('tr-total-enc',money(enc));sg('tr-total-dec',money(dec));
  // Transactions table
  g('t-treso').innerHTML=db.mouvements.slice(0,5).map((m,i)=>`<tr>
    <td class="mono" style="white-space:nowrap">${esc(fmtDate(m.date))} 10:${String(15+i*47%60).padStart(2,'0')}</td>
    <td class="bold">${esc(m.lib)}</td>
    <td><span class="badge ${m.type==='in'?'b-green':m.type==='out'?'b-red':'b-blue'}" style="font-size:11px">${m.type==='in'?'In':m.type==='out'?'Out':'Transfer'}</span></td>
    <td style="font-size:12px;color:#64748b">${m.mode?.includes('E-wallet')?'Main till → E-wallet':'Main till'}</td>
    <td style="font-size:12px;color:#64748b">${m.type==='in'?'Sales':m.type==='out'?'Stock purchase':'Transfer'}</td>
    <td class="mono" style="color:${m.type==='in'?'#16a34a':'#ef4444'};font-weight:600">${m.type==='in'?'+':'-'}${money(m.montant)}</td>
    <td style="font-size:12px">${m.mode||'Cash'}</td>
    <td><button style="background:none;border:none;cursor:pointer;font-size:18px;color:#94a3b8;padding:2px 4px;transition:color .15s" onmouseover="this.style.color='#374151'" onmouseout="this.style.color='#94a3b8'">⋮</button></td>
  </tr>`).join('')||emptyR(8);
  // Donut chart
  setTimeout(()=>renderTreasuryDonut(),60);
}
function renderTreasuryDonut(){
  if(tresoDonut){tresoDonut.destroy();tresoDonut=null;}
  const cv=g('tr-donut');if(!cv)return;
  // Expenses by category computed from db.depenses
  const cats={};db.depenses.forEach(d=>{cats[d.cat]=(cats[d.cat]||0)+d.montant;});
  const total=Object.values(cats).reduce((a,b)=>a+Number(b||0),0)||1,colors=['#16a34a','#3b82f6','#f59e0b','#a855f7','#ef4444','#64748b'];
  const data=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([label,amount],i)=>({label,amount:Number(amount)||0,pct:Math.round(Number(amount||0)/total*100),color:colors[i%colors.length]}));
  if(!data.length)data.push({label:'No expenses',amount:1,pct:0,color:'#e2e8f0'});
  const legend=g('tr-donut-legend');if(legend)legend.innerHTML=data.map(d=>`<div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px"><div style="display:flex;align-items:center;gap:7px"><div style="width:10px;height:10px;border-radius:50%;background:${d.color}"></div><span>${esc(d.label)}</span></div><span style="font-weight:600">${d.pct}%</span></div>`).join('');
  tresoDonut=new Chart(cv.getContext('2d'),{
    type:'doughnut',
    data:{
      labels:data.map(d=>d.label),
      datasets:[{data:data.map(d=>d.amount),backgroundColor:data.map(d=>d.color),borderWidth:2,borderColor:'#fff',hoverBorderWidth:3}]
    },
    options:{
      responsive:true,maintainAspectRatio:false,cutout:'68%',
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#fff',borderColor:'#e2e8f0',borderWidth:1,
          titleColor:'#374151',bodyColor:'#374151',padding:10,
          callbacks:{label:c=>c.label+' : '+money(c.parsed)}
        }
      }
    }
  });
}

/* ════════════════ EXPENSES ════════════════ */
function renderExpenses(){
  const depRows=db.depenses.map((d,i)=>`<tr>
    <td class="mono">${esc(fmtDate(d.date))}</td><td class="bold">${esc(d.lib)}</td>
    <td><span class="badge b-gray">${esc(d.cat)}</span></td>
    <td class="mono" style="color:#ef4444;font-weight:600">-${money(d.montant)}</td>
    <td>${esc(d.mode)}</td>
    <td><button class="btn btn-danger btn-xs" onclick="deleteExpense(${i})">Delete</button></td>
  </tr>`);
  renderPaginatedTable('t-dep',depRows,'No expenses recorded',6);
}
function deleteExpense(i){const d=db.depenses[i];if(!d)return;confirmDo(`Delete the expense " ${d.lib} " and its treasury outflow?`,()=>{let mi=db.mouvements.findIndex(m=>m.expenseId===d.id);if(mi<0)mi=db.mouvements.findIndex(m=>m.type==='out'&&m.lib===d.lib&&m.date===d.date&&Number(m.montant)===Number(d.montant));if(mi>=0)db.mouvements.splice(mi,1);db.depenses.splice(i,1);renderExpenses();renderTreasury();updateKPIs();saveAll();toast('Expense and movement deleted','amber');});}

/* ════════════════ EMPLOYEES ════════════════ */
function renderEmployees(){
  const tot=db.employes.reduce((a,e)=>a+e.salaire,0);
  const avg=db.employes.length?Math.round(db.employes.reduce((a,e)=>a+e.pres,0)/db.employes.length):0;
  sg('e-cnt',String(db.employes.length));sg('e-sal',amt(tot));sg('e-pres',avg+'%');
  const empRows=db.employes.map((e,i)=>`<tr>
    <td><div style="display:flex;align-items:center;gap:9px"><div style="width:30px;height:30px;border-radius:50%;background:#16a34a;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">${e.prenom[0]}${e.nom[0]}</div><span class="bold">${e.prenom} ${e.nom}</span></div></td>
    <td>${esc(e.poste)}</td><td class="mono">${esc(fmtDate(e.date))}</td>
    <td class="mono">${money(e.salaire)}</td>
    <td class="mono" style="color:#f59e0b">${money(employerLevies(e.salaire))}</td>
    <td><div style="display:flex;align-items:center;gap:7px"><div class="prog" style="width:55px"><div class="prog-f" style="width:${e.pres}%;background:${e.pres>=95?'#16a34a':e.pres>=80?'#f59e0b':'#ef4444'}"></div></div><span style="font-size:11px;color:#64748b">${e.pres}%</span></div></td>
    <td><span class="badge b-green">Active</span></td>
    <td><div style="display:flex;gap:5px"><button class="btn btn-outline btn-xs" onclick="generatePayslip(${i})">${icon('file')} Payslip</button><button class="btn btn-danger btn-xs" onclick="confirmDo('Delete this employee?',()=>{db.employes.splice(${i},1);renderEmployees();saveAll();})">×</button></div></td>
  </tr>`).join('')||emptyR(8);
}

/* ════════════════ SUPPLIERS ════════════════ */
function renderSuppliersLegacy(){
  g('t-fourn').innerHTML=db.fournisseurs.map((f,i)=>`<tr>
    <td class="bold">${f.nom}</td><td class="mono">${f.tel}</td>
    <td><span class="badge b-gray">${f.cat}</span></td>
    <td class="mono">${esc(fmtDate(f.derniere))}</td>
    <td><button class="btn btn-green btn-xs" onclick="openM('m-mouv')">Order</button></td>
  </tr>`).join('')||emptyR(5);
}

/* ════════════════ SAVE FORMS ════════════════ */
function saveCustomer(){
  const nom=gv('c-nom').trim();if(!nom){toast('Name required','red');return;}
  db.clients.push({id:'C'+uid(),nom,tel:gv('c-tel'),email:gv('c-email'),ville:gv('c-ville')||'Johannesburg',solde:0,type:gv('c-type'),credit:parseFloat(gv('c-credit'))||0,adr:gv('c-adr')});
  renderCustomers();closeM('m-cli');['c-nom','c-tel','c-email','c-ville','c-credit','c-adr'].forEach(id=>{const e=g(id);if(e)e.value='';});saveAll();toast('Customer added','green');
}
function saveInvoice(){
  const cli=gv('f-cli');if(!cli){toast('Choose a customer','red');return;}
  const ligs=getLines('f-lignes','f-tot');const ht=ligs.reduce((a,l)=>a+l.t,0);if(!ht){toast('Add at least one line','red');return;}
  const excess=ligs.find(l=>l.productId&&l.q>(db.produits.find(p=>p.id===l.productId)?.stk||0));if(excess){toast('Insufficient stock for '+excess.d,'red');return;}
  const tva=db.settings.tva||15;const montant=Math.round(ht*(1+tva/100));
  const num='TK-'+appNow().getFullYear()+'-'+String(db.factures.length+1).padStart(5,'0');
  db.factures.unshift({id:'V'+uid(),num,client:cli,date:gv('f-date')||today(),ech:gv('f-ech'),montant,statut:'Pending',mode:gv('f-mode'),lignes:ligs,caissier:CU?.label||CU?.nom||'User',caissierId:CU?.id});
  renderSales();closeM('m-facture');clearLines('f-lignes','f-tot');renderSetupGuide();saveAll();toast('Sale created — '+money(montant),'green');
}
function saveProduct(){
  const nom=gv('prod-nom').trim();if(!nom){toast('Name required','red');return;}
  const stk=parseInt(gv('prod-stk'))||0;
  db.produits.push({id:'P'+uid(),nom,ref:gv('prod-ref')||'REF-'+uid(),bc:gv('prod-bc'),cat:gv('prod-cat'),scat:gv('prod-scat'),stk,min:parseInt(gv('prod-min'))||10,pa:parseFloat(gv('prod-pa'))||0,pv:parseFloat(gv('prod-pv'))||0,lot:'',exp:''});
  renderProducts();renderStock();buildCats();buildPOS();closeM('m-prod');
  ['prod-nom','prod-ref','prod-bc','prod-stk','prod-min','prod-pa','prod-pv'].forEach(id=>{const e=g(id);if(e)e.value='';});
  const mb=g('mgr-box');if(mb)mb.style.display='none';
  updateKPIs();updateAlerts();renderSetupGuide();saveAll();toast('Product added — step complete ✓','green');
}
function saveSupplier(){
  const nom=gv('fo-nom').trim();if(!nom){toast('Name required','red');return;}
  db.fournisseurs.push({id:'F'+uid(),nom,tel:gv('fo-tel'),email:gv('fo-email'),cat:gv('fo-cat'),adr:gv('fo-adr'),derniere:today()});
  renderSuppliers();closeM('m-fourn');saveAll();toast('Supplier added','green');
}
function saveMovement(){
  const lib=gv('mv-lib').trim(),mont=parseFloat(gv('mv-mont'))||0;
  if(!lib||!mont){toast('Required fields missing','red');return;}
  const type=gv('mv-type');
  db.mouvements.unshift({id:'MV'+uid(),date:gv('mv-date')||today(),lib,type,montant:mont,mode:gv('mv-mode')});
  renderTreasury();closeM('m-mouv');['mv-lib','mv-mont'].forEach(id=>{const e=g(id);if(e)e.value='';});saveAll();
  toast((type==='in'?'In':'Out')+' of '+money(mont)+' recorded',type==='in'?'green':'red');
}
function saveExpense(){
  const lib=gv('dep-lib').trim(),mont=parseFloat(gv('dep-mont'))||0;
  if(!lib||!Number.isFinite(mont)||mont<=0){toast('Description and a positive amount are required','red');return;}
  const recur=gv('dep-recur')||'';
  const dep={id:'D'+uid(),date:gv('dep-date')||today(),lib,cat:gv('dep-cat'),montant:mont,mode:gv('dep-mode'),recur};
  db.depenses.unshift(dep);
  db.mouvements.unshift({id:'MV'+uid(),date:dep.date,lib,type:'out',montant:mont,mode:dep.mode,expenseId:dep.id});
  // If recurring, store in settings for auto-reminder
  if(recur){
    if(!db.settings.recurrentes)db.settings.recurrentes=[];
    db.settings.recurrentes.push({lib,cat:dep.cat,montant:mont,mode:dep.mode,recur,lastDate:dep.date});
    toast('Recurring expense recorded ✓','amber');
  }
  renderExpenses();renderTreasury();closeM('m-depense');saveAll();
  toast('Expense recorded','red');
}

function checkRecurringExpenses(){
  // Called on init — create due recurring expenses
  if(!db.settings.recurrentes)return;
  const td=today();
  db.settings.recurrentes.forEach(r=>{
    const last=new Date(r.lastDate);
    const now=new Date(td);
    let due=false;
    if(r.recur==='mensuel'){
      const diffM=(now.getFullYear()-last.getFullYear())*12+(now.getMonth()-last.getMonth());
      if(diffM>=1&&now.getDate()>=last.getDate())due=true;
    } else if(r.recur==='hebdo'){
      const diffD=Math.floor((now-last)/(1000*60*60*24));
      if(diffD>=7)due=true;
    }
    if(due){
      // Check not already created today
      const alreadyDone=db.depenses.find(d=>d.lib===r.lib&&d.date===td&&d.montant===r.montant);
      if(!alreadyDone){
        db.depenses.unshift({id:'D'+uid(),date:td,lib:r.lib+'(auto)',cat:r.cat,montant:r.montant,mode:r.mode,recur:r.recur});
        db.mouvements.unshift({id:'MV'+uid(),date:td,lib:r.lib+'(auto)',type:'out',montant:r.montant,mode:r.mode});
        r.lastDate=td;
        toast('Automatic recurring expense: '+r.lib,'amber');
      }
    }
  });
}
let _editingEmployee=-1;
function openEmployeeModal(i=-1){
  _editingEmployee=i;const e=i>=0?db.employes[i]:null;
  ['emp-pr','emp-nm','emp-po','emp-sal','emp-tel','emp-dt'].forEach(id=>{if(g(id))g(id).value='';});
  if(e){g('emp-pr').value=e.prenom||'';g('emp-nm').value=e.nom||'';g('emp-po').value=e.poste||'';g('emp-sal').value=toInput(e.salaire||0);g('emp-tel').value=e.tel||'';g('emp-dt').value=e.date||today();}
  const title=g('m-emp')?.querySelector('.modal-title');if(title)title.textContent=e?'Edit employee':'New employee';showCNSS();openM('m-emp');
}
function saveEmployee(){
  const p=gv('emp-pr').trim(),n=gv('emp-nm').trim();if(!p||!n){toast('First and last name required','red');return;}
  const previous=_editingEmployee>=0?db.employes[_editingEmployee]:null,data={id:previous?.id||'E'+uid(),prenom:p,nom:n,poste:gv('emp-po'),salaire:parseFloat(gv('emp-sal'))||0,tel:gv('emp-tel'),date:gv('emp-dt')||today(),pres:previous?.pres??100};
  if(previous)db.employes[_editingEmployee]=data;else db.employes.push(data);
  _editingEmployee=-1;renderEmployees();updateSummary();closeM('m-emp');saveAll();toast(previous?'Employee updated':p+' '+n+' added','green');
}
function deleteEmployee(i){const e=db.employes[i];if(!e)return;confirmDo(`Delete employee ${e.prenom} ${e.nom} ? Their leave history will be kept.`,()=>{db.employes.splice(i,1);renderEmployees();updateSummary();saveAll();toast('Employee deleted','amber');});}
function setMvT(t){g('mv-type').value=t;const i=g('mv-in'),o=g('mv-out');if(t==='in'){i.className='btn btn-success';o.className='btn btn-outline';}else{o.className='btn btn-danger';i.className='btn btn-outline';}}
function showCNSS(){const s=parseFloat(gv('emp-sal'))||0;const b=g('cnss-box');if(s>0){sg('cnss-v',money(employerLevies(s)));b.style.display='block';}else b.style.display='none';}

/* ════════════════ POS ════════════════ */
let posDay={count:0,ca:0,cash:0,mm:0};
let cashSession=null;
let lastCompletedTicket=null;
async function loadCashSession(){
  if(!API_TOKEN||!['admin','cashier'].includes(CU?.role))return;
  try{const result=await apiCall('GET','/caisse/session');cashSession=result.session;syncCashSessionUI();}catch(e){toast(e.message,'amber');}
}
function syncCashSessionUI(){
  const banner=g('cash-session-banner'),button=document.querySelector('.encaisse-btn');
  if(cashSession){
    posDay={count:Number(cashSession.nombre_ventes)||0,ca:Number(cashSession.total_ventes)||0,cash:Number(cashSession.ventes_especes)||0,mm:Number(cashSession.ventes_mobile)||0};
    if(banner){banner.className='alert-box ab-green';banner.innerHTML=`<span>✓</span><span>Session open · Opening float: <strong>${money(Number(cashSession.fonds_initial)||0)}</strong></span>`;}
  }else{
    posDay={count:0,ca:0,cash:0,mm:0};
    if(banner){banner.className='alert-box ab-amber';banner.innerHTML='<span>'+icon('lock')+'</span><span>Till closed. Open a session to take payments.</span><button class="btn btn-green btn-sm" style="margin-left:auto" onclick="openCashSessionModal()">Open the till</button>';}
  }
  if(button)button.disabled=!cashSession;updPOS();
}
function openCashSessionModal(){g('cash-opening-fund').value='0';openM('m-caisse-open');}
async function openCashSession(){
  const fund=Math.max(0,Number(gv('cash-opening-fund'))||0);
  try{const result=await apiCall('POST','/caisse/ouvrir',{fonds_initial:fund});cashSession=result.session;closeM('m-caisse-open');syncCashSessionUI();toast('Till open','green');}
  catch(e){toast(e.message,'red');}
}
function buildCats(){
  const cats=[...new Set(db.produits.map(p=>p.cat))];
  ['pcat-f','scat-f'].forEach(id=>{const el=g(id);if(el)el.innerHTML='<option value="">All</option>'+cats.map(c=>`<option>${esc(c)}</option>`).join('');});
}
function buildPOS(){
  const cats=['All',...new Set(db.produits.map(p=>p.cat))];
  const ct=g('pos-cats');if(ct)ct.innerHTML=cats.map((c,i)=>`<button class="cat-tab${i===0?' on':''}" data-cat="${esc(c)}" onclick="filterPOSCat(this.dataset.cat,this)">${esc(c)}</button>`).join('');
  const pc=g('pos-cli');if(pc)pc.innerHTML='<option value="">— Walk-in customer —</option>'+db.clients.map(c=>`<option value="${esc(c.id)}">${esc(c.nom)}</option>`).join('');
  renderPOSGrid('');
}
function renderPOSGrid(q,cat=''){
  const grid=g('pos-grid');if(!grid)return;
  const items=db.produits.filter(p=>{const mq=!q||p.nom.toLowerCase().includes(q.toLowerCase())||p.ref.toLowerCase().includes(q.toLowerCase());const mc=!cat||cat==='All'||p.cat===cat;return mq&&mc;});
  grid.innerHTML=items.map(p=>`<div class="pos-card${p.stk===0?' rupt':''}" onclick="addCart('${esc(p.id)}')">
    ${productAvatar(p.nom,'pos-card-ico')}
    <div class="pos-card-name">${esc(p.nom)}</div>
    <div class="pos-card-price">${money(p.pv)}</div>
    <div class="pos-card-stk" style="color:${p.stk===0?'#ef4444':p.stk<=p.min?'#f59e0b':'#16a34a'}">${p.stk===0?'Out of stock':p.stk+' in stock'}</div>
  </div>`).join('');
}
function filterPOS(q){renderPOSGrid(q,g('pos-cats')?.querySelector('.on')?.textContent||'');}
function filterPOSCat(c,btn){document.querySelectorAll('.cat-tab').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderPOSGrid(gv('pos-q')||'',c);}
function addCart(id){
  const p=db.produits.find(x=>x.id===id);if(!p||p.stk===0)return;
  const ex=cart.find(i=>i.id===id);
  if(ex){if(ex.qty>=p.stk){toast('Insufficient stock','red');return;}ex.qty++;}
  else cart.push({id,nom:p.nom,cat:p.cat,prix:p.pv,qty:1,max:p.stk});
  renderCart();
}
function renderCart(){
  const el=g('pos-cart');if(!el)return;
  const cnt=g('cart-cnt');if(cnt)cnt.textContent=String(cart.reduce((a,i)=>a+i.qty,0));
  if(!cart.length){el.innerHTML='<div class="pos-cart-empty"><div class="pos-cart-empty-icon">'+icon('cart')+'</div><strong>The cart is empty</strong><span>Select a product to start</span></div>';updPOS();return;}
  el.innerHTML=cart.map((item,i)=>`<div class="cart-item">
    <button class="ci-x" onclick="rmCart(${i})">×</button>
    <div class="ci-name">${esc(item.nom)}</div>
    <div class="qty-ctrl"><button class="qty-btn" onclick="chgQty(${i},-1)">−</button><span class="qty-num">${item.qty}</span><button class="qty-btn" onclick="chgQty(${i},+1)">+</button></div>
    <div class="ci-tot">${amt(item.prix*item.qty)}</div>
  </div>`).join('');
  updPOS();
}
function chgQty(i,d){cart[i].qty=Math.max(1,Math.min(cart[i].max,cart[i].qty+d));renderCart();}
function rmCart(i){cart.splice(i,1);renderCart();}
function clearCart(){cart=[];renderCart();}
function updPOS(){
  const sub=cart.reduce((a,i)=>a+i.prix*i.qty,0);
  // Discount calculation
  const rv=parseFloat(gv('pos-remise-val'))||0;
  const rt=gv('pos-remise-type')||'pct';
  const remise=rt==='pct'?roundMoney(sub*rv/100):Math.min(rv,sub);
  const total=Math.max(0,sub-remise);
  sg('pos-sub',money(sub));
  sg('pos-remise-display',remise>0?'-'+money(remise):money(0));
  sg('pos-tot',money(total));
  const ea=g('enc-amt');if(ea)ea.textContent=money(total);
  calcChange();
  sg('pos-d-ca',money(posDay.ca));sg('pos-d-cnt',String(posDay.count)+' transactions');
  sg('pos-d-cash',money(posDay.cash));sg('pos-d-mm',money(posDay.mm));
}
function getPOSDiscount(){
  const sub=cart.reduce((a,i)=>a+i.prix*i.qty,0);
  const rv=parseFloat(gv('pos-remise-val'))||0;
  const rt=gv('pos-remise-type')||'pct';
  return rt==='pct'?Math.round(sub*rv/100):Math.min(rv,sub);
}
function setPayMode(m){
  g('pos-mode').value=m;
  ['pay-esp','pay-mm','pay-credit'].forEach(id=>{const b=g(id);if(b)b.classList.remove('on');});
  const target=m==='Cash'?g('pay-esp'):m==='Credit'?g('pay-credit'):g('pay-mm');if(target)target.classList.add('on');
  const mw=g('monnaie-wrap');if(mw)mw.style.display=m==='Cash'?'block':'none';
}
function calcChange(){
  const sub=cart.reduce((a,i)=>a+i.prix*i.qty,0);
  const recu=parseFloat(gv('pos-recu'))||0;
  const md=g('monnaie-display');
  if(md){if(recu>0&&recu>=sub){md.style.display='block';sg('monnaie-val',money(recu-sub));}else md.style.display='none';}
}
async function processSale(){
  if(!cashSession){openCashSessionModal();toast('Open the till before taking payments','amber');return;}
  if(!cart.length){toast('Cart empty','red');return;}
  const subBrut=cart.reduce((a,i)=>a+i.prix*i.qty,0);
  const remise=getPOSDiscount();
  const sub=Math.max(0,subBrut-remise);
  const mode=gv('pos-mode')||'Cash';
  const client=db.clients.find(c=>c.id===gv('pos-cli'));
  const cli=client?.nom||'Walk-in customer';
  if(mode==='Credit'&&!client){toast('Select a customer for the credit sale','red');return;}
  const button=document.querySelector('.encaisse-btn');if(button)button.disabled=true;
  try{
    const result=await apiCall('POST','/caisse/ventes',{client_nom:cli,client_id:client?.id,mode,remise,lignes:cart.map(i=>({produit_id:i.id,quantite:i.qty}))});
    if(result.version!==undefined)STATE_VERSION=Number(result.version)||STATE_VERSION;
    db=mergeServerState(result.state);cashSession=result.session;lastCompletedTicket=result.ticket;notifyAdminOfCashierSale(result.ticket);syncCashSessionUI();
    clearCart();renderPOSGrid('');updateKPIs();updateAlerts();renderSetupGuide();saveAll();confetti();toast((mode==='Credit'?'Credit sale recorded — ':'Sale collected — ')+money(result.ticket.montant),'green');
    showTicket(result.ticket);
  }catch(e){toast(e.message,'red');await loadData();buildPOS();}
  finally{if(button)button.disabled=!cashSession;}
  const pr=g('pos-recu');if(pr)pr.value='';const md=g('monnaie-display');if(md)md.style.display='none';
  const prv=g('pos-remise-val');if(prv)prv.value='0';
}
let closingCashSession=null;
function closeTill(){
  closingCashSession=cashSession;
  if(!cashSession){toast('No open session','amber');return;}
  const theoretical=Number(cashSession.fonds_initial)+Number(cashSession.ventes_especes);
  g('cash-counted').value=toInput(theoretical);g('cash-close-recap').innerHTML=`<span>${icon('receipt')}</span><span>${Number(cashSession.nombre_ventes)||0} sale(s) · ${money(cashSession.total_ventes)}<br>Expected cash including opening float: <strong>${money(theoretical)}</strong></span>`;openM('m-caisse-close');
}
async function confirmCashClose(){
  const counted=Number(gv('cash-counted'));if(!Number.isFinite(counted)||counted<0){toast('Invalid counted amount','red');return;}
  try{const result=await apiCall('POST','/caisse/cloturer',{especes_comptees:counted,session_id:closingCashSession?.id});if(cashSession?.id===closingCashSession?.id)cashSession=null;closingCashSession=null;renderControl();closeM('m-caisse-close');syncCashSessionUI();showCashZReport(result.rapport_z);toast('Till closed and Z report locked','green');}
  catch(e){toast(e.message,'red');}
}
function showCashZReport(z){
  g('inv-content').innerHTML=`<div class="inv-preview" id="printable-inv"><div class="inv-hdr"><div><div class="inv-co">${esc(db.settings.nom)}</div><div>Till closing report</div></div><div class="inv-num-big">${esc(z.numero)}</div></div><div class="stat-row"><span>Cashier</span><strong>${esc(z.caissier)}</strong></div><div class="stat-row"><span>Number of sales</span><strong>${Number(z.nombre_ventes)||0}</strong></div><div class="stat-row"><span>Total sales</span><strong>${money(z.total_ventes)}</strong></div><div class="stat-row"><span>Cash collected</span><strong>${money(z.ventes_especes)}</strong></div><div class="stat-row"><span>E-wallet</span><strong>${money(z.ventes_mobile)}</strong></div><div class="stat-row"><span>Opening float</span><strong>${money(z.fonds_initial)}</strong></div><div class="stat-row"><span>Expected cash</span><strong>${money(z.especes_theoriques)}</strong></div><div class="stat-row"><span>Counted cash</span><strong>${money(z.especes_comptees)}</strong></div><div class="inv-total-bar"><span>DIFFERENCE</span><span>${z.ecart>0?'+':''}${money(z.ecart)}</span></div></div>`;openM('m-inv');
}
function printLastTicket(){
  if(cart.length){toast('Take payment for this cart first to generate its receipt','amber');return;}
  const last=lastCompletedTicket;if(!last){toast('No receipt collected during this session','amber');return;}
  showTicket(last);
}
function showTicket(last){
  if(!last)return;
  const lines=(last.lignes||[]).map(l=>`<div class="t-row"><span>${esc(l.d)} x${Number(l.q)||0}</span><span>${amt(l.t)}</span></div>`).join('');
  g('ticket-content').innerHTML=`<div class="ticket-wrap"><div class="t-title">${esc(db.settings.nom)}</div><div class="t-sub">${esc(db.settings.adresse)}</div><div class="t-sub">${esc(db.settings.tel)}</div><hr class="t-sep"/><div class="t-row"><span>Receipt</span><span>${esc(last.num)}</span></div><div class="t-row"><span>Date</span><span>${esc(fmtDate(last.date))}</span></div><div class="t-row"><span>Customer</span><span>${esc(last.client)}</span></div><hr class="t-sep"/>${lines}<hr class="t-sep"/><div class="t-row t-total"><span>TOTAL</span><span>${money(last.montant)}</span></div><hr class="t-sep"/><div style="text-align:center;font-size:10px;margin-top:6px">Thank you for your business!</div></div>`;
  openM('m-ticket');
}
function printTicketNow(){const h=g('ticket-content')?.innerHTML||'';const w=window.open('','_blank');w.document.write(`<!DOCTYPE html><html><body style="margin:0">${h}</body></html>`);w.document.close();w.print();}

/* ════════════════ SCANNER ════════════════ */
function lookBC(code){
  const res=g('bc-res');if(!res)return;if(!code||code.length<2){res.innerHTML='';return;}
  const p=db.produits.find(x=>x.bc===code||x.ref===code||x.nom.toLowerCase().includes(code.toLowerCase()));
  if(p){res.innerHTML=`<div class="alert-box ab-green" style="margin:10px 0"><span>✓</span><div><div style="font-weight:600">${esc(p.nom)}</div><div>${money(p.pv)} · Stock: ${Number(p.stk)||0}</div></div></div><div style="display:flex;gap:8px"><button class="btn btn-green btn-sm" onclick="nav('caisse',document.querySelector('.sb-item[data-p=caisse]'));setTimeout(()=>addCart('${esc(p.id)}'),150);closeM('m-scanner')">Add to cart</button><button class="btn btn-outline btn-sm" onclick="adjustStock(${db.produits.indexOf(p)});closeM('m-scanner')">Edit stock</button></div>`;}
  else{res.innerHTML=`<div class="alert-box ab-amber"><span>${icon('alert')}</span><span>Product not found</span></div><button class="btn btn-green btn-sm" onclick="openM('m-prod');closeM('m-scanner')">+ Create this product</button>`;}
}
function simScan(){
  const ps=db.produits.filter(p=>p.bc);const p=ps[Math.floor(Math.random()*ps.length)];if(!p)return;
  const inp=g('bc-in');if(!inp)return;inp.value='';let i=0;const code=p.bc;
  const iv=setInterval(()=>{inp.value+=code[i];i++;if(i>=code.length){clearInterval(iv);lookBC(code);}},50);
}

/* ════════════════ MODAL LINES ════════════════ */
function ensureSaleProductOptions(){
  let list=g('sale-product-options');
  if(!list){list=document.createElement('datalist');list.id='sale-product-options';document.body.appendChild(list);}
  list.replaceChildren(...db.produits.map(p=>{const option=document.createElement('option');option.value=p.nom;option.label=`${p.ref||p.id} · ${money(p.pv)} · Stock ${p.stk}`;return option;}));
}
function openSaleModal(){
  ensureSaleProductOptions();populateCustomers('f-cli');setDates();openM('m-facture');
  if(!g('f-lignes')?.children.length)addLine('f-lignes','f-tot');
}
function matchInventoryProduct(input,cid,tid){
  if(!['f-lignes','cmd-lignes'].includes(cid))return;
  const value=input.value.trim().toLocaleLowerCase(LOCALE);
  const product=db.produits.find(p=>p.nom.toLocaleLowerCase(LOCALE)===value||String(p.ref||'').toLocaleLowerCase(LOCALE)===value||String(p.bc||'')===value);
  const row=input.closest('[data-line-row]'),fields=row?.querySelectorAll('input');
  if(!row||!fields)return;
  if(!product){delete row.dataset.productId;fields[1].removeAttribute('max');input.title='';return;}
  row.dataset.productId=product.id;input.value=product.nom;input.title=`${product.ref||product.id} · Available stock: ${product.stk}`;
  if(cid==='f-lignes')fields[1].max=product.stk;else fields[1].removeAttribute('max');
  fields[2].value=toInput(cid==='cmd-lignes'?product.pa:product.pv);calcLT(cid,tid);
}
function addLine(cid,tid){
  if(!lc[cid])lc[cid]=0;lc[cid]++;
  const lid=cid+'-r'+lc[cid];const div=document.createElement('div');div.id=lid;
  div.dataset.lineRow='';
  div.style.cssText='display:grid;grid-template-columns:1fr 60px 80px 80px 24px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9';
  const productAttrs=['f-lignes','cmd-lignes'].includes(cid)?` list="sale-product-options" autocomplete="off" oninput="matchInventoryProduct(this,'${cid}','${tid}')" onchange="matchInventoryProduct(this,'${cid}','${tid}')"`:'';
  div.innerHTML=`<input class="fi" placeholder="Description"${productAttrs} style="font-size:12.5px;padding:8px 10px"/><input class="fi" type="number" value="1" min="1" style="font-size:12px;padding:8px;text-align:center" oninput="calcLT('${cid}','${tid}')"/><input class="fi" type="number" placeholder="0" style="font-size:12px;padding:8px" oninput="calcLT('${cid}','${tid}')"/><span style="font-size:12px;font-family:'Inter',sans-serif;text-align:right;color:#64748b" id="${lid}-t">0</span><button style="background:none;border:none;color:#d1d5db;cursor:pointer;font-size:17px;line-height:1" onclick="g('${lid}').remove();calcLT('${cid}','${tid}')" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#d1d5db'">×</button>`;
  g(cid).appendChild(div);div.querySelector('input').focus();
}
function calcLT(cid,tid){
  let tot=0;g(cid).querySelectorAll('div[id]').forEach(row=>{const ins=row.querySelectorAll('input');const sub=(parseFloat(ins[1]?.value)||0)*toBase(parseFloat(ins[2]?.value)||0);tot+=sub;const sp=row.querySelector('[id$="-t"]');if(sp)sp.textContent=amt(sub);});
  const tva=db.settings.tva||15;const displayed=cid==='f-lignes'?roundMoney(tot*(1+tva/100)):tot;const el=g(tid);if(el)el.textContent=money(displayed);return tot;
}
function getLines(cid,tid){const rows=[];g(cid).querySelectorAll('div[id]').forEach(row=>{const ins=row.querySelectorAll('input');const d=ins[0]?.value.trim(),q=parseFloat(ins[1]?.value)||0,pu=toBase(parseFloat(ins[2]?.value)||0);if(d)rows.push({d,q,pu,t:q*pu,productId:row.dataset.productId||''});});return rows;}
function clearLines(cid,tid){g(cid)?.querySelectorAll('div[id]').forEach(r=>r.remove());const el=g(tid);if(el)el.textContent=money(0);if(lc[cid])lc[cid]=0;}
function calcMgr(){const a=parseFloat(gv('prod-pa'))||0,v=parseFloat(gv('prod-pv'))||0;const box=g('mgr-box');if(a>0&&v>0){const m=Math.round((v-a)/a*100);sg('mgr-val',m+'% · '+money(v-a)+'/unit');g('mgr-val').style.color=m>=20?'#16a34a':m>=10?'#f59e0b':'#ef4444';box.style.display='block';}else box.style.display='none';}
function updateSubcategories(){const cat=gv('prod-cat');const cats={Food:['Cereals & starches','Oils & fats','Dry groceries','Dairy','Canned goods','Condiments','Snacks'],Hygiene:['Household cleaning','Personal care','Baby products','Disinfectants'],Drinks:['Water & soft drinks','Fruit juice','Energy drinks','Alcohol'],Hardware:['Household items','Tools','Screws & bolts','Electricity'],Electronics:['Phones','Accessories','Audio','Computing'],Textiles:['Men\'s clothing','Women\'s clothing','Children','Fabric'],'Building materials':['Cement & mortar','Paint','Plumbing','Tiling'],Other:['Miscellaneous']};const el=g('prod-scat');if(el)el.innerHTML=(cats[cat]||['Miscellaneous']).map(c=>`<option>${c}</option>`).join('');}

/* ════════════════ SELECTS ════════════════ */
function populateCustomers(id){const s=g(id);if(!s)return;const empty=document.createElement('option');empty.value='';empty.textContent='— Select —';s.replaceChildren(empty,...db.clients.map(c=>{const option=document.createElement('option');option.textContent=c.nom;return option;}));}
function setDates(){const fd=g('f-date');if(fd)fd.value=today();const fe=g('f-ech');if(fe){const d=appNow();d.setDate(d.getDate()+30);fe.value=d.toISOString().split('T')[0];}const md=g('mv-date');if(md)md.value=today();const dd=g('dep-date');if(dd)dd.value=today();}

/* ════════════════ PARAMS ════════════════ */
function loadSettings(){
  ['nom','slogan','adresse','ville','web','tel','email','rccm','niu','mentions','tva'].forEach(k=>{const el=g('p-'+k);if(el)el.value=db.settings[k]||'';});
  const col=g('p-color');if(col&&db.settings.color)col.value=db.settings.color;
  // Load logo
  if(db.settings.logo){
    const img=g('logo-preview'),ph=g('logo-placeholder');
    if(img){img.src=db.settings.logo;img.style.display='block';}
    if(ph)ph.style.display='none';
  }
  updateHeaderPreview();
  // Apply accent color
  if(db.settings.color)document.documentElement.style.setProperty('--accent-color',db.settings.color);
  renderTestClock();
}

function datetimeLocalValue(date){
  const pad=value=>String(value).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function renderTestClock(){
  const card=g('test-clock-card'),input=g('test-clock-datetime'),status=g('test-clock-status');
  if(card)card.style.display=TEST_CLOCK_ENABLED&&CU?.role==='admin'?'block':'none';
  if(input&&!input.matches(':focus'))input.value=datetimeLocalValue(appNow());
  if(status)status.textContent=TEST_CLOCK_ACTIVE?'Active: '+now():'Inactive: real time';
}
async function loadTestClock(){
  if(!API_TOKEN)return;
  try{const result=await apiCall('GET','/test-clock');TEST_CLOCK_ENABLED=!!result.enabled;TEST_CLOCK_ACTIVE=!!result.active;TEST_CLOCK_OFFSET_MS=TEST_CLOCK_ACTIVE?new Date(result.now).getTime()-Date.now():0;renderTestClock();}
  catch(_){TEST_CLOCK_ENABLED=false;TEST_CLOCK_ACTIVE=false;TEST_CLOCK_OFFSET_MS=0;}
}
async function setTestClock(){
  const value=gv('test-clock-datetime');if(!value){toast('Choose a date and time','red');return;}
  try{const result=await apiCall('PUT','/test-clock',{datetime:new Date(value).toISOString()});TEST_CLOCK_ACTIVE=true;TEST_CLOCK_OFFSET_MS=new Date(result.now).getTime()-Date.now();renderTestClock();sg('tb-date',appNow().toLocaleDateString(LOCALE,{day:'numeric',month:'long',year:'numeric'}));setDates();toast('Test clock enabled','amber');}
  catch(e){toast(e.message,'red');}
}
async function resetTestClock(){
  try{await apiCall('PUT','/test-clock',{reset:true});TEST_CLOCK_ACTIVE=false;TEST_CLOCK_OFFSET_MS=0;renderTestClock();sg('tb-date',appNow().toLocaleDateString(LOCALE,{day:'numeric',month:'long',year:'numeric'}));setDates();toast("Back to real time",'green');}
  catch(e){toast(e.message,'red');}
}
function saveSettings(){
  ['nom','slogan','adresse','ville','web','tel','email','rccm','niu','mentions'].forEach(k=>{const el=g('p-'+k);if(el)db.settings[k]=el.value;});
  db.settings.tva=parseFloat(gv('p-tva'))||15;
  
  const col=g('p-color');if(col)db.settings.color=col.value;
  saveAll();
  updateHeaderPreview();
  // Update topbar accent color live
  document.documentElement.style.setProperty('--accent-color', db.settings.color||'#16a34a');
  renderSetupGuide();
  toast('Settings saved ✓','green');
}
function exportData(){const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='kinta-backup-'+today()+'.json';a.click();toast('Data exported','green');}
function resetAll(){db=JSON.parse(JSON.stringify(DEF));saveAll();renderDash();toast('Reset','red');}

function controlRecordCount(){
  return ['produits','clients','factures','mouvements','depenses','employes','fournisseurs','journal','commandes','retours','inventaires','reglements_clients']
    .reduce((n,k)=>n+(Array.isArray(db[k])?db[k].length:0),0);
}
async function renderControl(){
  const missingStock=(db.produits||[]).filter(p=>!Number.isFinite(Number(p.stk))||Number(p.stk)<0);
  const badAmounts=[...(db.factures||[]),...(db.mouvements||[]),...(db.depenses||[])].filter(x=>!Number.isFinite(Number(x.montant))||Number(x.montant)<0);
  const orphanReturns=(db.retours||[]).filter(r=>r.facture&&!db.factures.some(f=>f.id===r.facture||f.num===r.facture));
  const alerts=missingStock.length+badAmounts.length+orphanReturns.length;
  sg('ctrl-alerts',String(alerts));
  const sessions=g('ctrl-sessions');
  if(sessions)sessions.innerHTML='<tr><td colspan="8" class="control-no-data">Loading sessions…</td></tr>';
  try{
    const result=await apiCall('GET','/caisse/sessions?limit=50'),rows=result.sessions||[],activeRows=rows.filter(s=>s.statut==='open');
    sg('ctrl-caisse',activeRows.length?String(activeRows.length)+' open':'Closed');
    sg('ctrl-caisse-sub',activeRows.length?activeRows.map(s=>s.utilisateur_nom).join(', '):'No active session');
    if(sessions)sessions.innerHTML=rows.map(s=>{
      const opened=new Date(s.ouverte_le).toLocaleString(LOCALE);
      const variance=s.statut==='open'?'—':`${Number(s.ecart)>0?'+':''}${money(Number(s.ecart)||0)}`;
      return `<tr><td class="bold">${s.utilisateur_nom||'User'}</td><td class="mono">${opened}</td><td class="mono">${money(Number(s.fonds_initial)||0)}</td><td>${Number(s.nombre_ventes)||0}</td><td class="mono">${money(Number(s.total_ventes)||0)}</td><td class="mono" style="color:${Number(s.ecart)?'#ef4444':'inherit'}">${variance}</td><td><span class="badge ${s.statut==='open'?'b-green':'b-gray'}">${s.statut==='open'?'Open':'Closed'}</span></td><td>${s.statut==='open'?`<button class="btn btn-danger btn-xs" onclick="closeManagedCash('${s.id}')">Close</button>`:s.rapport_z?`<button class="btn btn-outline btn-xs" onclick='showStoredCashZ(${JSON.stringify(s.rapport_z)})'>Z report</button>`:'—'}</td></tr>`;
    }).join('')||'<tr><td colspan="8" class="control-no-data">No sessions recorded</td></tr>';
  }catch(e){
    sg('ctrl-caisse','Unavailable');sg('ctrl-caisse-sub','Could not load sessions');
    if(sessions)sessions.innerHTML=`<tr><td colspan="8" class="control-no-data">${e.message}</td></tr>`;
  }
  await renderCommerceSupportRequests();
  controlAuditRows=[
    ...(db.mouvements||[]).map(x=>({date:x.date,user:CU?.label||'admin',action:x.lib||'Cash movement',target:'Treasury',details:`${x.type==='in'?'In':x.type==='out'?'Out':'Transfer'} · ${money(Number(x.montant)||0)}`})),
    ...(db.journal||[]).map(x=>({date:x.date,user:CU?.label||'admin',action:x.lib||'Journal entry',target:'Accounting',details:x.piece||x.id||'—'}))
  ].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,50);
  sg('ctrl-total',String(controlAuditRows.length));
  renderControlLog(controlAuditRows);
}
async function renderCommerceSupportRequests(){
  const tbody=g('ctrl-support-requests');if(!tbody||CU?.role!=='admin')return;
  try{const rows=(await apiCall('GET','/assistance-demandes')).demandes||[];tbody.innerHTML=rows.map(r=>`<tr><td class="bold">${esc(r.agent)}</td><td>${esc(r.motif)}</td><td class="mono">${new Date(String(r.demande_le).replace(' ','T')+'Z').toLocaleString(LOCALE)}</td><td><span class="badge ${r.statut==='approved'?'b-green':r.statut==='refused'?'b-red':'b-amber'}">${esc(r.statut)}</span></td><td>${r.statut==='pending'?`<button class="btn btn-success btn-xs" onclick="decideSupportRequest('${esc(r.id)}','approved')">Approve 30 min</button> <button class="btn btn-danger btn-xs" onclick="decideSupportRequest('${esc(r.id)}','refused')">Refuse</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="5" class="control-no-data">No support requests</td></tr>';}catch(e){tbody.innerHTML=`<tr><td colspan="5" class="control-no-data">${esc(e.message)}</td></tr>`;}
}
async function decideSupportRequest(id,statut){try{await apiCall('PATCH','/assistance-demandes/'+id,{statut});toast(statut==='approved'?'Access approved for 30 minutes':'Request refused',statut==='approved'?'green':'amber');renderCommerceSupportRequests();}catch(e){toast(e.message,'red');}}
function showStoredCashZ(raw){try{showCashZReport(typeof raw==='string'?JSON.parse(raw):raw);}catch(_){toast('Z report unreadable','red');}}
let controlAuditRows=[];
function renderControlLog(rows){
  const tb=g('ctrl-log');if(!tb)return;
  tb.innerHTML=rows.map(x=>`<tr><td class="mono">${esc(fmtDate(x.date)||'—')}</td><td>${esc(x.user)}</td><td class="bold">${esc(x.action)}</td><td>${esc(x.target)}</td><td>${esc(x.details)}</td></tr>`).join('')||`<tr><td colspan="5" class="control-no-data">No actions recorded</td></tr>`;
}
function filterControlLog(value){
  const q=String(value||'').trim().toLocaleLowerCase(LOCALE);
  renderControlLog(q?controlAuditRows.filter(x=>Object.values(x).some(v=>String(v).toLocaleLowerCase(LOCALE).includes(q))):controlAuditRows);
}
function exportControlStock(){
  const columns=['Reference','Product','Category','Stock','Minimum stock','Cost price (R)','Selling price (R)'];
  const rows=(db.produits||[]).map(p=>[p.ref||p.id,p.nom,p.cat,p.stk,p.min,toInput(p.pa),toInput(p.pv)]);
  const csv=[columns,...rows].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='kinta-stock-'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),0);toast('Stock exported','green');
}
function markControlBackup(){localStorage.setItem('kinta_last_backup',new Date().toISOString());}
function saveControlNow(){saveAll();markControlBackup();renderControl();toast('Data saved','green');}
function exportControlBackup(){markControlBackup();exportData();renderControl();}
function restoreControlBackup(input){
  const file=input.files&&input.files[0];if(!file)return;
  const reader=new FileReader();reader.onload=e=>{try{const data=JSON.parse(e.target.result);if(!data||typeof data!=='object'||!Array.isArray(data.produits)||!Array.isArray(data.factures))throw new Error();confirmDo('Replace the current data with this backup?',()=>{db={...JSON.parse(JSON.stringify(DEF)),...data};saveAll();markControlBackup();renderControl();renderDash();toast('Backup restored','green');});}catch(err){toast('Invalid backup file','red');}finally{input.value='';}};reader.readAsText(file);
}

/* ════════════════ REPORTS ════════════════ */
/* ════════════════════════════════════════════
   LOGO & PARAMS HELPERS
════════════════════════════════════════════ */
function handleLogoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('Logo too large (max 2 MB)', 'red'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    db.settings.logo = e.target.result; // base64
    const img = g('logo-preview'), ph = g('logo-placeholder');
    if (img) { img.src = e.target.result; img.style.display = 'block'; }
    if (ph)  ph.style.display = 'none';
    saveAll();
    updateHeaderPreview();
    toast('Logo saved ✓', 'green');
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  delete db.settings.logo;
  const img = g('logo-preview'), ph = g('logo-placeholder');
  if (img) { img.src = ''; img.style.display = 'none'; }
  if (ph)  ph.style.display = '';
  saveAll(); updateHeaderPreview(); toast('Logo removed', 'amber');
}

function updateHeaderPreview() {
  const s = db.settings;
  const col = s.color || '#16a34a';
  const prev = g('header-preview');
  if (!prev) return;
  prev.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;padding-bottom:12px;border-bottom:3px solid ${col};margin-bottom:8px">
      ${s.logo ? `<img src="${s.logo}" style="height:60px;width:auto;object-fit:contain;flex-shrink:0"/>` : `<div style="width:60px;height:60px;background:${col};border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800;flex-shrink:0">${(s.nom||'K')[0]}</div>`}
      <div>
        <div style="font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-.5px">${s.nom||'Company name'}</div>
        ${s.slogan ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${s.slogan}</div>` : ''}
        <div style="font-size:11px;color:#94a3b8;margin-top:3px">${[s.adresse,s.tel,s.email].filter(Boolean).join(' · ')}</div>
        ${s.rccm ? `<div style="font-size:10px;color:#94a3b8">Reg. no.: ${s.rccm}${s.niu?' · VAT no.: '+s.niu:''}</div>` : ''}
      </div>
    </div>
    <div style="font-size:10px;color:#94a3b8;text-align:center">Preview of the header that appears on all your PDF exports</div>`;
}

/* ════════════════════════════════════════════
   EXPORT HTML→PDF PROFESSIONNEL
════════════════════════════════════════════ */
function buildExportHeader(title, subtitle, color) {
  const s = db.settings;
  const col = color || s.color || '#16a34a';
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0 0 20px;border-bottom:3px solid ${col};margin-bottom:24px">
      <div style="display:flex;align-items:center;gap:18px">
        ${s.logo
          ? `<img src="${s.logo}" style="height:70px;width:auto;object-fit:contain"/>`
          : `<div style="width:70px;height:70px;background:${col};border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:900">${(s.nom||'K')[0]}</div>`
        }
        <div>
          <div style="font-size:24px;font-weight:900;color:#0f172a;letter-spacing:-.5px;line-height:1">${s.nom||'Kinta ERP'}</div>
          ${s.slogan ? `<div style="font-size:13px;color:#64748b;margin-top:3px">${s.slogan}</div>` : ''}
          <div style="font-size:12px;color:#94a3b8;margin-top:4px">${[s.adresse,s.ville].filter(Boolean).join(', ')}</div>
          <div style="font-size:12px;color:#94a3b8">${[s.tel,s.email].filter(Boolean).join(' · ')}</div>
          ${s.rccm ? `<div style="font-size:11px;color:#94a3b8">Reg. no.: ${s.rccm}${s.niu?' · VAT no.: '+s.niu:''}</div>` : ''}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:800;color:${col}">${title}</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">${subtitle}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:3px">Generated on ${appNow().toLocaleDateString(LOCALE,{day:'numeric',month:'long',year:'numeric'})}</div>
        ${s.web ? `<div style="font-size:11px;color:#94a3b8">${s.web}</div>` : ''}
      </div>
    </div>`;
}

function buildExportFooter() {
  return `
    <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:11px;color:#94a3b8">${db.settings.nom||''} · ${db.settings.adresse||''}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:20px;height:20px;background:#16a34a;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#fff">K</div>
        <div style="font-size:11px;color:#94a3b8">Created with <strong style="color:#16a34a">Kinta ERP</strong> · kinta-erp.com</div>
      </div>
      <div style="font-size:11px;color:#94a3b8">Page 1</div>
    </div>`;
}

function buildExportTable(cols, rows, color) {
  const col = color || db.settings.color || '#16a34a';
  const head = cols.map(c => `<th style="background:${col};color:#fff;padding:10px 12px;text-align:left;font-size:12px;font-weight:600;white-space:nowrap">${c}</th>`).join('');
  const body = rows.map((r, ri) => {
    const cells = r.map((cell, ci) => {
      const isNum = typeof cell === 'number' || (typeof cell === 'string' && /^-?R\s[\d,.]+$/.test(cell));
      const style = `padding:9px 12px;font-size:12.5px;border-bottom:1px solid #f1f5f9;${isNum?'text-align:right;font-weight:600':''}`;
      return `<td style="${style}">${cell}</td>`;
    }).join('');
    return `<tr style="background:${ri%2===0?'#fff':'#f9fafb'}">${cells}</tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:20px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildKPICards(kpis, color) {
  const col = color || db.settings.color || '#16a34a';
  const cards = kpis.map(k => `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;flex:1">
      <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${k.label}</div>
      <div style="font-size:20px;font-weight:800;color:${k.color||'#0f172a'}">${k.value}</div>
      ${k.sub ? `<div style="font-size:11px;color:#64748b;margin-top:3px">${k.sub}</div>` : ''}
    </div>`).join('');
  return `<div style="display:flex;gap:10px;margin-bottom:24px">${cards}</div>`;
}

function openExportPDF(html, filename) {
  const full = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>${filename}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;font-size:13px;color:#0f172a;background:#fff;padding:32px 40px}
@media print{body{padding:20px}@page{margin:1.5cm;size:A4}}
</style>
</head>
<body>${html}</body>
</html>`;
  if (window.kintaAPI) {
    window.kintaAPI.printInvoice(full);
    return;
  }
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(full);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 600);
}

/* ════════════════════════════════════════════
   NEW genReport — styled exports
════════════════════════════════════════════ */
function genReport(type,format='pdf') {
  const s = db.settings;
  const col = s.color || '#16a34a';
  let html = '', title = '', subtitle = '';

  /* ── SALES ── */
  if (type === 'sales') {
    title = 'Sales Report'; subtitle = 'All recorded sales';
    const paid   = db.factures.filter(f => f.statut === 'Paid');
    const att    = db.factures.filter(f => f.statut !== 'Paid');
    const totalCA = db.factures.reduce((a,f) => a+f.montant, 0);
    const kpis = [
      {label:'Total sales',    value: money(totalCA), color: col},
      {label:'Paid invoices', value: String(paid.length), sub: money(paid.reduce((a,f)=>a+f.montant,0))},
      {label:'Pending',      value: String(att.length),  color:'#f59e0b', sub: money(att.reduce((a,f)=>a+f.montant,0))},
      {label:'Total count',    value: String(db.factures.length)},
    ];
    const rows = db.factures.map(f => [f.num, f.client, fmtDate(f.date), money(f.montant), f.mode||'—', f.statut==='Paid'?'✓ Paid':'Pending']);
    html = buildKPICards(kpis, col) + buildExportTable(['Receipt no.','Customer','Date','Amount incl. tax','Payment method','Status'], rows, col);
  }

  /* ── STOCK ── */
  else if (type === 'stock') {
    title = 'Stock Report'; subtitle = 'Full stock status as of '+appNow().toLocaleDateString(LOCALE);
    const val   = db.produits.reduce((a,p) => a+p.stk*p.pa, 0);
    const rupt  = db.produits.filter(p => p.stk === 0).length;
    const low   = db.produits.filter(p => p.stk > 0 && p.stk <= p.min).length;
    const kpis = [
      {label:'Total stock value', value: money(val), color: col},
      {label:'Products in stock',      value: String(db.produits.filter(p=>p.stk>0).length)},
      {label:'Low stock',           value: String(low), color:'#f59e0b'},
      {label:'Out of stock',      value: String(rupt), color:'#ef4444'},
    ];
    const rows = db.produits.map(p => [
      p.nom, p.ref, p.cat,
      String(p.stk),
      String(p.min),
      money(p.pa),
      money(p.pv),
      money(p.stk*p.pa),
      p.stk===0?'Out of stock':p.stk<=p.min?'Low':'✓ OK',
    ]);
    html = buildKPICards(kpis, col) + buildExportTable(['Product','Reference','Category','Stock','Min.','Cost price','Selling price','Stock value','Status'], rows, col);
  }

  /* ── TREASURY ── */
  else if (type === 'treasury') {
    title = 'Treasury Report'; subtitle = 'Full movement history';
    const enc = db.mouvements.filter(m=>m.type==='in').reduce((a,m)=>a+m.montant,0);
    const dec = db.mouvements.filter(m=>m.type==='out').reduce((a,m)=>a+m.montant,0);
    const kpis = [
      {label:'Total income',  value: money(enc), color: col},
      {label:'Total outgoings',  value: money(dec), color:'#ef4444'},
      {label:'Net balance',        value: money(enc-dec), color: enc>=dec?col:'#ef4444'},
      {label:'No. of transactions',  value: String(db.mouvements.length)},
    ];
    const rows = db.mouvements.map(m => [fmtDate(m.date), m.lib, `<span style="color:${m.type==='in'?'#16a34a':m.type==='out'?'#ef4444':'#2563eb'};font-weight:bold">${m.type==='in'?'↑ In':m.type==='out'?'↓ Out':'↔ Transfer'}</span>`, money(m.montant), m.mode||'—']);
    html = buildKPICards(kpis, col) + buildExportTable(['Date','Description','Type','Amount','Method'], rows, col);
  }

  /* ── RH ── */
  else if (type === 'hr') {
    title = 'Human Resources Report'; subtitle = 'Staff and payroll costs';
    const totSal = db.employes.reduce((a,e) => a+e.salaire, 0);
    const totCNSS = employerLevies(totSal);
    const kpis = [
      {label:'Total headcount',     value: String(db.employes.length)},
      {label:'Payroll',    value: money(totSal), color: col},
      {label:'Employer UIF + SDL (2%)', value: money(totCNSS), color:'#f59e0b'},
      {label:'Average attendance',   value: db.employes.length ? Math.round(db.employes.reduce((a,e)=>a+e.pres,0)/db.employes.length)+'%' : '—'},
    ];
    const rows = db.employes.map(e => [e.prenom+' '+e.nom, e.poste, fmtDate(e.date), money(e.salaire), money(employerLevies(e.salaire)), e.pres+'%', 'Active']);
    html = buildKPICards(kpis, col) + buildExportTable(['Employee','Position','Hired on','Gross salary','UIF + SDL (2%)','Attendance','Status'], rows, col);
  }

  /* ── BALANCE SHEET ── */
  else if (type === 'balance-sheet') {
    title = 'Monthly Statement'; subtitle = appNow().toLocaleDateString(LOCALE,{month:'long',year:'numeric'});
    const rec = db.mouvements.filter(m=>m.type==='in').reduce((a,m)=>a+m.montant,0);
    const dep = db.mouvements.filter(m=>m.type==='out').reduce((a,m)=>a+m.montant,0);
    const stk = db.produits.reduce((a,p)=>a+p.stk*p.pa,0);
    const tva = vatIncluded(rec);
    const net = rec - dep;
    const kpis = [
      {label:'Revenue', value: money(rec), color: col},
      {label:'Total expenses',     value: money(dep), color:'#ef4444'},
      {label:'Net income',        value: money(net), color: net>=0?col:'#ef4444'},
      {label:'VAT payable',      value: money(tva), color:'#a855f7'},
    ];
    const rows = [
      ['Revenue incl. tax (sales collected)', money(rec), '70 — Sales'],
      ['Goods purchased', money(db.depenses.filter(d=>d.cat==='Stock purchase').reduce((a,d)=>a+d.montant,0)), '60 — Purchases'],
      ['Rent & charges', money(db.depenses.filter(d=>d.cat==='Rent').reduce((a,d)=>a+d.montant,0)), '62 — Expenses'],
      ['Payroll', money(db.employes.reduce((a,e)=>a+e.salaire,0)), '64 — Staff'],
      ['Employer UIF + SDL (2%)', money(employerLevies(db.employes.reduce((a,e)=>a+e.salaire,0))), '43 — UIF/SDL'],
      ['VAT collected ('+vatRate()+'%)', money(tva), '44 — VAT'],
      ['Stock value', money(stk), '31 — Goods'],
      ['NET INCOME', money(net), ''],
    ];
    html = buildKPICards(kpis, col) + buildExportTable(['Indicator','Amount','OHADA account'], rows, col);
  }

  /* ── JOURNAL ── */
  else if (type === 'journal') {
    title = 'Accounting Journal'; subtitle = 'OHADA accounting entries';
    const allEcr = [
      ...db.factures.filter(f=>f.statut==='Paid').map(f=>({date:f.date,lib:f.num+' — '+f.client,compte:'70',type:'credit',montant:f.montant})),
      ...db.depenses.map(d=>({date:d.date,lib:d.lib,compte:'60',type:'debit',montant:d.montant})),
      ...(db.journal||[]),
    ].sort((a,b)=>b.date.localeCompare(a.date));
    const rows = allEcr.map(e => [fmtDate(e.date), e.lib, e.compte, e.type==='debit'?money(e.montant):'—', e.type==='credit'?money(e.montant):'—']);
    html = buildExportTable(['Date','Label','Account','Debit','Credit'], rows, col);
  }

  /* ── RETURNS ── */
  else if (type === 'returns') {
    title = 'Returns Report'; subtitle = 'Customer and supplier returns';
    const retours = db.retours || [];
    const rows = retours.map(r => [fmtDate(r.date), r.ticket||'—', r.nom, r.produit, String(r.qty), r.type, r.statut, r.motif, money(r.montant)]);
    html = buildExportTable(['Date','Receipt no.','Customer/Supplier','Product','Qty','Type','Status','Reason','Amount'], rows, col);
  }

  else { toast('Unknown report type', 'red'); return; }

  const full = buildExportHeader(title, subtitle, col) + html + buildExportFooter();
  if(format==='excel'){downloadTreasuryExcel();return;}
  openExportPDF(full, 'kinta-'+type+'-'+today());
  toast('Report opened — use Ctrl+P to print/save as PDF', 'green');
}

/* ════════════════ TABLE HELPERS ════════════════ */
function filterT(tbodyId,q,cols){document.getElementById(tbodyId)?.querySelectorAll('tr').forEach(row=>{const text=cols.map(c=>row.cells[c]?.textContent||'').join(' ').toLowerCase();row.style.display=text.includes(q.toLowerCase())?'':'none';});}
function emptyR(cols,msg='No items'){return `<tr><td colspan="${cols}" style="text-align:center;color:#94a3b8;padding:28px;font-size:13px">${msg}</td></tr>`;}

/* ════════════════ MODAL ════════════════ */
function openM(id){const el=g(id);if(el){el.classList.add('open');const f=el.querySelector('input,select,textarea');if(f)setTimeout(()=>f.focus(),80);}}
function closeM(id){const el=g(id);if(el)el.classList.remove('open');}
document.querySelectorAll('.modal-overlay,.confirm-wrap').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open');}));

let _confirmCb=null;
function confirmDo(msg,cb){_confirmCb=cb;sg('confirm-msg',msg);g('confirm-ok').onclick=()=>{if(_confirmCb)_confirmCb();closeM('m-confirm');};openM('m-confirm');}

/* ════════════════ TOAST ════════════════ */
function toast(msg,type='green'){
  const t=document.createElement('div');t.className='toast t'+type[0];
  const dot=document.createElement('div'),label=document.createElement('span'),bar=document.createElement('div');dot.className='t-dot';bar.className='t-bar';label.textContent=String(msg);t.replaceChildren(dot,label,bar);
  t.onclick=()=>t.remove();g('toasts').appendChild(t);
  setTimeout(()=>{t.style.transition='opacity .3s,transform .3s';t.style.opacity='0';t.style.transform='translateX(15px)';setTimeout(()=>t.remove(),300);},3500);
}

/* ════════════════ CONFETTI ════════════════ */
function confetti(){const colors=['#16a34a','#4ade80','#dcfce7','#166534','#86efac'];for(let i=0;i<28;i++){const el=document.createElement('div');el.className='cf';el.style.cssText=`left:${20+Math.random()*60}%;top:0;background:${colors[Math.floor(Math.random()*colors.length)]};animation-delay:${Math.random()*.4}s;animation-duration:${.9+Math.random()*.7}s;width:${5+Math.random()*7}px;height:${5+Math.random()*7}px;border-radius:${Math.random()>.5?'50%':'2px'}`;document.body.appendChild(el);setTimeout(()=>el.remove(),1400);}}

/* ════════════════════════════════════════════
   DARK MODE
════════════════════════════════════════════ */
let isDark = localStorage.getItem('kinta_dark') === '1';
function applyTheme(){
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const btn = g('dark-toggle');
  if(btn) btn.innerHTML = icon(isDark ? 'sun' : 'moon') + `<span>${isDark ? 'Light mode' : 'Dark mode'}</span>`;
}
function toggleDark(){
  isDark = !isDark;
  localStorage.setItem('kinta_dark', isDark ? '1' : '0');
  applyTheme();
}
applyTheme();

/* ── Profile menu (dark mode, sign out) ── */
function closeProfileMenu(){
  const menu=g('profile-menu');if(!menu||menu.hidden)return;
  menu.hidden=true;g('profile-button')?.setAttribute('aria-expanded','false');
}
function toggleProfileMenu(event){
  event?.stopPropagation();const menu=g('profile-menu');if(!menu)return;
  menu.hidden=!menu.hidden;g('profile-button')?.setAttribute('aria-expanded',String(!menu.hidden));
  if(!menu.hidden)menu.querySelector('button')?.focus();
}
document.addEventListener('click',e=>{if(!g('profile-wrap')?.contains(e.target))closeProfileMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!g('profile-menu')?.hidden){closeProfileMenu();g('profile-button')?.focus();}});

/* ════════════════════════════════════════════
   PAGE TITLES — extended
════════════════════════════════════════════ */
PAGE_TITLES['retours'] = 'Returns';
PAGE_TITLES['comptabilite'] = 'Accounting';

/* ════════════════════════════════════════════
   CALCULATOR
════════════════════════════════════════════ */
let calcState={display:'0',operand:null,operator:null,awaiting:false,justEq:false,expr:''};
const calcSymbol=op=>op==='/'?'÷':op==='*'?'×':op;
function calcCompute(a,op,b){
  if(op==='+')return a+b;if(op==='-')return a-b;if(op==='*')return a*b;if(op==='/')return b===0?NaN:a/b;return b;
}
function calcNumber(value){return String(Math.round(value*100000000)/100000000);}
function calcAct(k){
  let s=calcState;
  if(k==='C')calcState=s={display:'0',operand:null,operator:null,awaiting:false,justEq:false,expr:''};
  else if(/^\d+$/.test(k)||k==='.'){
    if(s.justEq){s.display='0';s.operand=null;s.operator=null;s.expr='';s.justEq=false;}
    if(k==='.'&&s.display.includes('.')&&!s.awaiting)return;
    if(s.awaiting){s.display=k==='.'?'0.':k.replace(/^0+(?=\d)/,'');s.awaiting=false;}
    else if(k==='.')s.display=s.display==='Error'?'0.':s.display+'.';
    else s.display=s.display==='0'||s.display==='Error'?k:s.display+k;
    s.expr=s.operator!==null?`${calcNumber(s.operand)} ${calcSymbol(s.operator)} ${s.display}`:s.display;
  }else if(['+','-','*','/'].includes(k)){
    const current=Number(s.display);
    if(!Number.isFinite(current))return calcAct('C');
    if(s.operator!==null&&!s.awaiting){const result=calcCompute(s.operand,s.operator,current);if(!Number.isFinite(result)){s.display='Error';s.expr='Division by zero';s.operand=null;s.operator=null;s.awaiting=true;}else{s.display=calcNumber(result);s.operand=result;}}
    else s.operand=current;
    if(s.display!=='Error'){s.operator=k;s.awaiting=true;s.justEq=false;s.expr=`${calcNumber(s.operand)} ${calcSymbol(k)}`;}
  }else if(k==='='){
    if(s.operator!==null&&!s.awaiting){const current=Number(s.display),result=calcCompute(s.operand,s.operator,current);s.expr=`${calcNumber(s.operand)} ${calcSymbol(s.operator)} ${s.display} =`;s.display=Number.isFinite(result)?calcNumber(result):'Error';s.operand=null;s.operator=null;s.awaiting=true;s.justEq=true;}
  }else if(k==='±'){
    const value=Number(s.display);if(Number.isFinite(value)){s.display=calcNumber(-value);s.expr=s.operator!==null?`${calcNumber(s.operand)} ${calcSymbol(s.operator)} ${s.display}`:s.display;}
  }else if(k==='%'){
    const value=Number(s.display);if(Number.isFinite(value)){s.display=calcNumber(value/100);s.expr=s.operator!==null?`${calcNumber(s.operand)} ${calcSymbol(s.operator)} ${s.display}`:s.display;}
  }
  sg('calc-display',s.display);sg('calc-expr',s.expr);
}

/* ════════════════════════════════════════════
   RETURNS — data + render
════════════════════════════════════════════ */
if(!db.retours) db.retours = [
  {id:'R001',date:'2026-05-12',ticket:'TK-2026-00126',nom:'Nkosi & Sons Distributors',produit:'Vegetable oil 5L',qty:2,type:'Customer',statut:'Refunded',motif:'Defective product',montant:11000,notes:''},
  {id:'R002',date:'2026-05-10',ticket:'TK-2026-00121',nom:"Mama Thandi's Spaza",produit:'Refined sugar 50kg',qty:1,type:'Customer',statut:'Exchanged',motif:'Wrong product delivered',montant:27000,notes:'Exchange done'},
];

function renderReturns(){
  const total = db.retours.filter(r=>r.statut==='Refunded').reduce((a,r)=>a+Number(r.montant||0),0);
  const cli = db.retours.filter(r=>r.type==='Customer').length;
  const fourn = db.retours.filter(r=>r.type==='Supplier').length;
  sg('ret-total',String(db.retours.length));sg('ret-cli',String(cli));sg('ret-fourn',String(fourn));sg('ret-rembourse',money(total));
  g('t-retours').innerHTML = db.retours.map((r,i)=>`<tr>
    <td class="mono">${esc(fmtDate(r.date))}</td>
    <td class="bold mono">${esc(r.ticket||'—')}</td>
    <td>${esc(r.produit)}</td>
    <td style="text-align:center;font-weight:600">${r.qty}</td>
    <td><span class="badge ${r.type==='Customer'?'b-blue':'b-amber'}">${r.type}</span></td>
    <td><span class="badge ${r.statut==='Refunded'?'b-green':r.statut==='Exchanged'?'b-blue':r.statut==='Refused'?'b-red':'b-amber'}">${r.statut}</span></td>
    <td style="font-size:12px;color:#64748b">${esc(r.motif)}</td>
    <td class="mono" style="color:#ef4444;font-weight:600">-${money(r.montant)}</td>
    <td><button class="btn btn-danger btn-xs" onclick="confirmDo('Delete this return?',()=>{db.retours.splice(${i},1);renderReturns();saveAll();})">Delete</button></td>
  </tr>`).join('')||emptyR(9,'No returns recorded');
}

let _returnTicket=null,_returnLookupTimer=null;
function openReturnModal(){
  _returnTicket=null;['ret-ticket','ret-nom','ret-notes'].forEach(id=>{if(g(id))g(id).value='';});
  if(g('ret-qty'))g('ret-qty').value='1';if(g('ret-montant'))g('ret-montant').value='0';
  if(g('ret-prod'))g('ret-prod').innerHTML='<option value="">Enter the receipt number first</option>';openM('m-retour');
}
function scheduleReturnTicketLookup(){clearTimeout(_returnLookupTimer);_returnLookupTimer=setTimeout(loadReturnTicket,350);}
async function loadReturnTicket(){
  const ref=gv('ret-ticket').trim();_returnTicket=null;if(!ref)return;
  try{
    const result=await apiCall('GET','/retours/ticket/'+encodeURIComponent(ref));_returnTicket=result.ticket;
    g('ret-nom').value=_returnTicket.client_nom||'Walk-in customer';
    g('ret-prod').innerHTML=_returnTicket.lignes.map((l,i)=>`<option value="${i}">${esc(l.nom)} — bought: ${esc(l.quantite)}, returnable: ${esc(l.quantite_disponible)}</option>`).join('');
    g('ret-qty').value='1';updateReturnAmount();toast('Receipt found — details loaded','green');
  }catch(e){g('ret-prod').innerHTML='<option value="">Receipt not found</option>';g('ret-montant').value='0';toast(e.message,'red');}
}
function updateReturnAmount(){
  const line=_returnTicket?.lignes?.[Number(gv('ret-prod'))],qty=Math.max(0,Number(gv('ret-qty'))||0);
  if(!line){g('ret-montant').value='0';return;}
  g('ret-qty').max=line.quantite_disponible;g('ret-montant').value=qty<=line.quantite_disponible?toInput(line.prix_net_unitaire*qty):0;
}
async function saveReturn(){
  const lineIndex=Number(gv('ret-prod')),line=_returnTicket?.lignes?.[lineIndex],qty=parseInt(gv('ret-qty'))||0;
  if(!_returnTicket||!line){toast('Enter a valid receipt number','red');return;}
  if(qty<1||qty>line.quantite_disponible){toast('Quantity exceeds the returnable quantity','red');return;}
  const statut=gv('ret-action')||'Pending';
  try{
    const result=await apiCall('POST','/retours',{ticket_ref:_returnTicket.numero,ligne_index:lineIndex,quantite:qty,statut,motif:gv('ret-motif'),notes:gv('ret-notes')});
    if(result.version!==undefined)STATE_VERSION=Number(result.version)||STATE_VERSION;
    db=mergeServerState(result.state);renderReturns();closeM('m-retour');toast('Return recorded — '+money(result.retour.montant),'green');
  }catch(e){toast(e.message,'red');}
}

/* ════════════════════════════════════════════
   SUPPLIER ORDERS
════════════════════════════════════════════ */
if(!db.commandes) db.commandes = [
  {id:'CMD001',num:'CMD-2026-001',fourn:'Naidoo & Sons (Pty) Ltd',date:'2026-05-10',livraison:'2026-05-20',statut:'Received',montant:450000,notes:'',lignes:[{d:'Fragrant rice 25kg',q:30,pu:12000,t:360000},{d:'Vegetable oil 5L',q:20,pu:4500,t:90000}]},
  {id:'CMD002',num:'CMD-2026-002',fourn:'Mokoena Import-Export',date:'2026-05-08',livraison:'2026-05-25',statut:'Confirmed',montant:280000,notes:'Urgent delivery',lignes:[]},
];

function populateSuppliers(id){const s=g(id);if(!s)return;const empty=document.createElement('option');empty.value='';empty.textContent='— Select —';s.replaceChildren(empty,...db.fournisseurs.map(f=>{const option=document.createElement('option');option.textContent=f.nom;return option;}));}
function switchSupplierTab(tab){
  ['liste'].forEach(t=>{
    const btn=g('ftab-'+t),cont=g('ftab-content-'+t);
    if(btn)btn.classList.toggle('on',t===tab);
    if(cont)cont.style.display=t===tab?'':'none';
  });
  if(tab==='liste')renderSuppliers();
}
function renderOrders(){
  const tbody=g('t-ach-commandes');if(!tbody)return;
  tbody.innerHTML=db.commandes.map((c,i)=>`<tr>
    <td class="bold mono">${esc(c.num)}</td>
    <td>${esc(c.fourn)}</td>
    <td class="mono">${esc(fmtDate(c.date))}</td>
    <td class="mono">${esc(fmtDate(c.livraison)||'—')}</td>
    <td><span class="badge ${c.statut==='Received'?'b-green':c.statut==='Confirmed'?'b-blue':c.statut==='Sent'?'b-amber':c.statut==='Cancelled'?'b-red':'b-gray'}">${c.statut}</span></td>
    <td class="mono" style="font-weight:600">${money(c.montant)}</td>
    <td><div style="display:flex;gap:5px">
      <button class="btn btn-outline btn-xs" onclick="previewOrder(${i})">${icon('eye')} View</button>
      ${c.statut!=='Received'&&c.statut!=='Cancelled'?`<button class="btn btn-success btn-xs" onclick="openPurchaseReceipt(${i})">✓ Receive</button>`:''}
      ${c.statut!=='Received'?`<button class="btn btn-danger btn-xs" onclick="confirmDo('Delete?',()=>{db.commandes.splice(${i},1);renderPurchases();saveAll();})">×</button>`:''}
    </div></td>
  </tr>`).join('')||emptyR(7,'No orders');
}
function saveOrder(statut){
  const fourn=gv('cmd-fourn');if(!fourn){toast('Supplier required','red');return;}
  const ligs=getLines('cmd-lignes','cmd-tot');const montant=ligs.reduce((a,l)=>a+l.t,0);
  const num='CMD-'+appNow().getFullYear()+'-'+String(db.commandes.length+1).padStart(3,'0');
  db.commandes.unshift({id:'CMD'+uid(),num,fourn,date:gv('cmd-date')||today(),livraison:gv('cmd-livraison'),statut,montant,notes:gv('cmd-notes'),lignes:ligs});
  // Update the supplier's last order date
  const f=db.fournisseurs.find(x=>x.nom===fourn);if(f)f.derniere=today();
  renderOrders();closeM('m-commande');clearLines('cmd-lignes','cmd-tot');saveAll();
  toast(`Order ${statut.toLowerCase()} — ${money(montant)}`,'green');
}
function receiveOrder(i){
  openPurchaseReceipt(i);
}
function openPurchaseOrder(){
  ensureSaleProductOptions();populateSuppliers('cmd-fourn');setDates();const date=g('cmd-date');if(date)date.value=today();openM('m-commande');
}
function switchPurchaseTab(tab){
  ['commandes','factures','mouvements'].forEach(name=>{
    g('achat-tab-'+name)?.classList.toggle('on',name===tab);
    const content=g('achat-content-'+name);if(content)content.style.display=name===tab?'':'none';
  });
  if(tab==='commandes')renderOrders();else if(tab==='factures')renderPurchaseInvoices();else renderProductMovements();
}
function renderPurchases(){
  db.achats=db.achats||[];db.commandes=db.commandes||[];
  const total=db.achats.reduce((sum,a)=>sum+Number(a.total||0),0);
  const paid=db.achats.reduce((sum,a)=>sum+Number(a.paye||0),0);
  sg('ach-total',money(total));sg('ach-paye',money(paid));sg('ach-dette',money(Math.max(0,total-paid)));
  sg('ach-attente',String(db.commandes.filter(c=>!['Received','Cancelled'].includes(c.statut)).length));
  renderOrders();renderPurchaseInvoices();
}
function renderPurchaseInvoices(){
  const tbody=g('t-ach-factures');if(!tbody)return;
  tbody.innerHTML=(db.achats||[]).map((a,i)=>{
    const due=Math.max(0,Number(a.total)-Number(a.paye));
    const status=due<=0?'Paid':Number(a.paye)>0?'Partly paid':'To pay';
    return `<tr><td class="mono bold">${esc(a.facture)}</td><td>${esc(a.fourn)}</td><td class="mono">${esc(fmtDate(a.date))}</td><td class="mono">${money(a.total)}</td><td class="mono green">${money(a.paye)}</td><td class="mono" style="color:${due?'#ef4444':'#16a34a'};font-weight:700">${money(due)}</td><td><span class="badge ${due<=0?'b-green':a.paye>0?'b-amber':'b-red'}">${status}</span></td><td>${due>0?`<button class="btn btn-green btn-xs" onclick="openPurchasePayment(${i})">Pay</button>`:'—'}</td></tr>`;
  }).join('')||emptyR(8,'No supplier invoices received');
}
function openPurchaseReceipt(index){
  const c=db.commandes[index];if(!c||c.statut==='Received')return;
  if(!(c.lignes||[]).length){toast('Add at least one item to the order','red');return;}
  g('rec-cmd-index').value=index;g('rec-date').value=today();g('rec-facture').value='FAC-'+c.num;
  g('rec-frais').value='0';g('rec-paye').value='0';
  g('recap-reception').innerHTML=`<span>${icon('package')}</span><span><strong>${esc(c.num)}</strong> · ${esc(c.fourn)}<br>${c.lignes.length} article(s) · ${money(c.montant)}</span>`;
  updateReceptionTotal();openM('m-reception-achat');
}
function updateReceptionTotal(){
  const c=db.commandes[Number(gv('rec-cmd-index'))];if(!c)return;
  const total=Number(c.montant||0)+(Number(gv('rec-frais'))||0),paid=Number(gv('rec-paye'))||0,due=Math.max(0,total-paid);
  g('rec-paye').max=toInput(total);g('rec-solde').innerHTML=`<span>ℹ</span><span>Total posted: <strong>${money(total)}</strong> · Debt created: <strong>${money(due)}</strong></span>`;
}
function addPurchaseJournal(date,lib,piece,compte,type,montant){
  if(montant<=0)return;db.journal=db.journal||[];db.journal.unshift({id:'J'+uid(),date,lib,piece,compte,type,montant});
}
function confirmPurchaseReceipt(){
  const index=Number(gv('rec-cmd-index')),c=db.commandes[index];if(!c||c.statut==='Received')return;
  const facture=gv('rec-facture').trim(),date=gv('rec-date')||today(),fees=Math.max(0,Number(gv('rec-frais'))||0);
  const total=Number(c.montant||0)+fees,paid=Math.max(0,Number(gv('rec-paye'))||0);
  if(!facture){toast('Invoice number required','red');return;}if(paid>total){toast('Payment exceeds the invoice total','red');return;}
  if((db.achats||[]).some(a=>a.facture===facture)){toast('This supplier invoice already exists','red');return;}
  c.statut='Received';c.reception=date;c.facture=facture;
  (c.lignes||[]).forEach(line=>{const p=db.produits.find(x=>x.id===line.productId||x.nom===line.d);if(p){const oldQty=Number(p.stk||0),inQty=Number(line.q||0),oldCost=Number(p.pa||0),inCost=Number(line.pu||0);p.pa=(oldQty+inQty)>0?roundMoney((oldQty*oldCost+inQty*inCost)/(oldQty+inQty)):inCost;p.stk=oldQty+inQty;}});
  db.achats=db.achats||[];db.achats.unshift({id:'ACH'+uid(),commandeId:c.id,commande:c.num,facture,fourn:c.fourn,date,total,paye:paid,mode:gv('rec-mode'),frais:fees,paiements:paid?[{id:'PAY'+uid(),date,montant:paid,mode:gv('rec-mode')}]:[]});
  db.depenses.unshift({id:'D'+uid(),date,lib:'Stock purchase — '+facture,cat:'Stock purchase',montant:total,mode:paid>=total?gv('rec-mode'):'Supplier credit'});
  if(paid>0)db.mouvements.unshift({id:'MV'+uid(),date,lib:'Supplier payment '+facture+' — '+c.fourn,type:'out',montant:paid,mode:gv('rec-mode')});
  addPurchaseJournal(date,'Stock purchase '+facture,facture,'60','debit',total);
  addPurchaseJournal(date,'Supplier payment '+facture,facture,'57','credit',paid);
  addPurchaseJournal(date,'Supplier debt '+facture,facture,'40','credit',total-paid);
  closeM('m-reception-achat');renderPurchases();renderStock();renderTreasury();renderAccounting();saveAll();confetti();
  toast('Receipt recorded: stock, finance and accounting updated','green');
}
function openPurchasePayment(index){
  const a=db.achats[index];if(!a)return;const due=Math.max(0,Number(a.total)-Number(a.paye));if(due<=0)return;
  g('pay-ach-index').value=index;g('pay-ach-montant').value=toInput(due);g('pay-ach-montant').max=toInput(due);g('pay-ach-date').value=today();
  g('pay-ach-recap').innerHTML=`<span>${icon('card')}</span><span>${esc(a.facture)} · ${esc(a.fourn)}<br>Balance due: <strong>${money(due)}</strong></span>`;openM('m-paiement-achat');
}
function savePurchasePayment(){
  const index=Number(gv('pay-ach-index')),a=db.achats[index];if(!a)return;
  const due=Math.max(0,Number(a.total)-Number(a.paye)),amount=capTo(Number(gv('pay-ach-montant'))||0,due),date=gv('pay-ach-date')||today(),mode=gv('pay-ach-mode');
  if(amount<=0||amount>due){toast('Invalid amount or greater than the debt','red');return;}
  a.paye=Number(a.paye||0)+amount;a.paiements=a.paiements||[];a.paiements.unshift({id:'PAY'+uid(),date,montant:amount,mode});
  db.mouvements.unshift({id:'MV'+uid(),date,lib:'Supplier payment '+a.facture+' — '+a.fourn,type:'out',montant:amount,mode});
  addPurchaseJournal(date,'Debt payment '+a.facture,a.facture,'40','debit',amount);addPurchaseJournal(date,'Treasury outflow '+a.facture,a.facture,'57','credit',amount);
  closeM('m-paiement-achat');renderPurchases();renderTreasury();renderAccounting();saveAll();toast('Supplier payment recorded','green');
}
function previewOrder(i){
  const c=db.commandes[i];
  const rows=c.lignes.map(l=>`<tr><td>${esc(l.d)}</td><td style="text-align:center">${l.q}</td><td style="text-align:right">${amt(l.pu)}</td><td style="text-align:right">${amt(l.t)}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:10px">No details</td></tr>';
  g('inv-content').innerHTML=`<div class="inv-preview" id="printable-inv">
    <div class="inv-hdr">
      <div><div class="inv-co">${esc(db.settings.nom)}</div><div style="color:#64748b;font-size:12px">${esc(db.settings.adresse)}</div><div style="color:#64748b;font-size:12px">${esc(db.settings.tel)}</div></div>
      <div style="text-align:right"><div style="font-size:11px;color:#64748b;margin-bottom:4px">SUPPLIER PURCHASE ORDER</div><div class="inv-num-big">${c.num}</div><span class="inv-badge ${c.statut==='Received'?'inv-paid':'inv-pend'}">${c.statut}</span><div style="font-size:12px;color:#64748b;margin-top:6px">Date: ${esc(fmtDate(c.date))}</div><div style="font-size:12px;color:#64748b">Expected delivery: ${esc(fmtDate(c.livraison)||'—')}</div></div>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:12px 14px;margin-bottom:14px"><div style="font-size:11px;color:#9ca3af;margin-bottom:2px">SUPPLIER</div><div style="font-size:15px;font-weight:700">${esc(c.fourn)}</div></div>
    <table class="inv-table"><thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="inv-total-bar" style="margin-top:14px"><span>ORDER TOTAL</span><span>${money(c.montant)}</span></div>
    ${c.notes?`<div style="margin-top:12px;font-size:12px;color:#64748b"><strong>Notes:</strong> ${c.notes}</div>`:''}
  </div>`;
  openM('m-inv');
}

/* ════════════════════════════════════════════
   ACCOUNTING / JOURNAL
════════════════════════════════════════════ */
if(!db.journal) db.journal = [];

function renderAccounting(){
  // Ensure journal tab is visible by default
  const jcont=g('ctab-content-journal');
  if(jcont&&jcont.style.display==='none'){
    switchAccountingTab('journal');
    return;
  }
  const ca=db.factures.filter(f=>f.statut==='Paid').reduce((a,f)=>a+f.montant,0);
  const charges=db.depenses.reduce((a,d)=>a+d.montant,0)+db.employes.reduce((a,e)=>a+e.salaire,0);
  const tva=vatIncluded(ca);
  const net=ca-charges;
  sg('cpt-ca',money(ca));sg('cpt-charges',money(charges));
  sg('cpt-net',money(net));const nel=g('cpt-net');if(nel)nel.style.color=net>=0?'#16a34a':'#ef4444';
  sg('cpt-tva',money(tva));
  // Accounts
  sg('cpt-70',money(ca));
  const achats=db.depenses.filter(d=>d.cat==='Stock purchase').reduce((a,d)=>a+d.montant,0);
  sg('cpt-60',money(achats));
  const loyer=db.depenses.filter(d=>d.cat==='Rent').reduce((a,d)=>a+d.montant,0);
  sg('cpt-62',money(loyer));
  const sal=db.employes.reduce((a,e)=>a+e.salaire,0);
  sg('cpt-64',money(sal));
  sg('cpt-44c',money(tva));sg('cpt-44d',money(vatIncluded(achats)));
  sg('cpt-resultat',money(net));g('cpt-resultat')?.classList.toggle('amount-neg',net<0);
  // Balance sheet
  const treso=db.mouvements.filter(m=>m.type==='in').reduce((a,m)=>a+m.montant,0)-db.mouvements.filter(m=>m.type==='out').reduce((a,m)=>a+m.montant,0);
  const stk=db.produits.reduce((a,p)=>a+p.stk*p.pa,0);
  const creances=db.factures.filter(f=>f.statut!=='Paid').reduce((a,f)=>a+f.montant,0);
  const assets=treso+stk+creances;
  sg('bilan-tresorerie',money(treso));sg('bilan-stock',money(stk));sg('bilan-creances',money(creances));sg('bilan-assets-total',money(assets));
  sg('bilan-resultat',money(net));sg('bilan-dettes','—');sg('bilan-tva-p',money(tva));sg('bilan-liabilities-total',money(1000000+net));
  // Journal
  const allEcr=[
    ...db.factures.filter(f=>f.statut==='Paid').map(f=>({date:f.date,lib:f.num+' — '+f.client,compte:'70',type:'credit',montant:f.montant})),
    ...db.depenses.map(d=>({date:d.date,lib:d.lib,compte:'60/62',type:'debit',montant:d.montant})),
    ...db.journal,
  ].sort((a,b)=>b.date.localeCompare(a.date));
  g('t-journal').innerHTML=allEcr.slice(0,15).map((e,i)=>`<tr>
    <td class="mono">${esc(fmtDate(e.date))}</td><td class="bold">${esc(e.lib)}</td>
    <td><span class="badge b-gray">${esc(e.compte)}</span></td>
    <td class="mono" style="color:${e.type==='debit'?'#ef4444':'#64748b'}">${e.type==='debit'?money(e.montant):'—'}</td>
    <td class="mono" style="color:${e.type==='credit'?'#16a34a':'#64748b'}">${e.type==='credit'?money(e.montant):'—'}</td>
  </tr>`).join('')||emptyR(5,'No entries');
}

function saveEntry(){
  const lib=gv('ecr-lib').trim(),mont=parseFloat(gv('ecr-montant'))||0;
  if(!lib||!mont){toast('Label and amount required','red');return;}
  db.journal.unshift({id:'ECR'+uid(),date:gv('ecr-date')||today(),lib,piece:gv('ecr-piece'),compte:gv('ecr-compte'),type:gv('ecr-type'),montant:mont});
  renderAccounting();closeM('m-ecriture');saveAll();toast('Entry recorded','green');
  ['ecr-lib','ecr-piece','ecr-montant'].forEach(id=>{const e=g(id);if(e)e.value='';});
}

/* ════════════════════════════════════════════
   SUPPLIERS — updated renderSuppliers
════════════════════════════════════════════ */
// Override renderSuppliers to include total purchases
function renderSuppliers(){
  g('t-fourn').innerHTML=db.fournisseurs.map((f,i)=>{
    const totalAchats=db.commandes.filter(c=>c.fourn===f.nom&&c.statut==='Received').reduce((a,c)=>a+c.montant,0);
    return `<tr>
      <td class="bold">${esc(f.nom)}</td>
      <td class="mono">${esc(f.tel)}</td>
      <td><span class="badge b-gray">${esc(f.cat)}</span></td>
      <td class="mono">${esc(fmtDate(f.derniere))}</td>
      <td class="mono" style="color:#16a34a">${totalAchats>0?money(totalAchats):'—'}</td>
      <td><div style="display:flex;gap:5px">
        <button class="btn btn-green btn-xs" onclick="openM('m-commande');populateSuppliers('cmd-fourn');setTimeout(()=>{const s=g('cmd-fourn');if(s){for(let o of s.options){if(o.text==='${f.nom}'){s.value=o.value;break;}}}},50)">Order</button>
        <button class="btn btn-danger btn-xs" onclick="confirmDo('Delete?',()=>{db.fournisseurs.splice(${i},1);renderSuppliers();saveAll();})">×</button>
      </div></td>
    </tr>`;
  }).join('')||emptyR(6,'No suppliers');
}

/* Visual initialisation, independent of navigation. */
document.addEventListener('DOMContentLoaded', ()=>{
  applyTheme();
});

// Unified navigation: keeps the existing modules behind a single entry.
function switchUnified(page,parent){
  nav(page,null);
  document.querySelectorAll('.sb-item').forEach(n=>n.classList.remove('on'));
  const item=document.querySelector('.sb-item[data-p="'+parent+'"]');
  if(item)item.classList.add('on');
  sg('pg-title',parent==='rapports'?'Reports':'Treasury');
}

function navAdmin(section,el){
  nav('parametres',el);
  if(section!=='utilisateurs')return;
  sg('pg-title','Users');
  setTimeout(()=>{
    const title=[...document.querySelectorAll('#page-parametres .card-title')]
      .find(e=>e.textContent.includes('User management'));
    if(title)title.closest('.card').scrollIntoView({behavior:'smooth',block:'start'});
  },50);
}

/* ════════════════════════════════════════════
   REPORT — extend genReport for journal
════════════════════════════════════════════ */
const _origGenReport = genReport;
window.genReport = function(type){
  if(type==='journal'){
    const csv='Date,Label,Account,Debit,Credit'+'\n'+db.journal.map(e=>`"${e.date}","${e.lib}","${e.compte}",${e.type==='debit'?toInput(e.montant):0},${e.type==='credit'?toInput(e.montant):0}`).join('\n');
    const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='kinta-journal-'+today()+'.csv';a.click();
    toast('Journal exported','green');return;
  }
  _origGenReport(type);
};

/* ════════════════════════════════════════════
   INIT APP — patch to init new data + dark
════════════════════════════════════════════ */
const _origInitApp = initApp;
window.initApp = async function(){
  await _origInitApp();
  // Ensure new data arrays
  if(!db.retours)db.retours=[];
  if(!db.commandes)db.commandes=[];
  if(!db.journal)db.journal=[];
  // Apply dark mode
  applyTheme();
  checkRecurringExpenses();
  // Set date on new modals
  const rd=g('ret-date');if(rd)rd.value=today();
  const cd=g('cmd-date');if(cd)cd.value=today();
  const ed=g('ecr-date');if(ed)ed.value=today();
};


/* ════════════════════════════════════════════
   PAGINATION UNIVERSELLE
════════════════════════════════════════════ */
const PAGE_SIZE = 15;
let currentPage = {};

function paginate(tbodyId, allRows, page) {
  const total = allRows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.max(1, Math.min(page, pages));
  currentPage[tbodyId] = page;
  const start = (page-1)*PAGE_SIZE;
  const visible = allRows.slice(start, start+PAGE_SIZE);
  const tbody = g(tbodyId);
  if(!tbody) return;
  tbody.innerHTML = visible.join('');
  // Render pagination bar
  const wrap = g(tbodyId+'-pager');
  if(!wrap) return;
  if(total <= PAGE_SIZE){ wrap.innerHTML=''; return; }
  let btns = '';
  const prev = page>1 ? `<button class="pg-btn" onclick="goPage('${tbodyId}',${page-1})">‹ Prev</button>` : `<button class="pg-btn" disabled>‹ Prev</button>`;
  const next = page<pages ? `<button class="pg-btn" onclick="goPage('${tbodyId}',${page+1})">Suiv. ›</button>` : `<button class="pg-btn" disabled>Suiv. ›</button>`;
  for(let p=1;p<=pages;p++){
    if(p===1||p===pages||Math.abs(p-page)<=1){
      btns+=`<button class="pg-btn${p===page?' pg-on':''}" onclick="goPage('${tbodyId}',${p})">${p}</button>`;
    } else if(Math.abs(p-page)===2){
      btns+='<span style="color:#94a3b8;padding:0 4px">…</span>';
    }
  }
  wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0 0;border-top:1px solid #f1f5f9">
    <div style="font-size:12px;color:#64748b">Showing ${start+1}–${Math.min(start+PAGE_SIZE,total)} of ${total}</div>
    <div style="display:flex;align-items:center;gap:4px">${prev}${btns}${next}</div>
  </div>`;
}

function goPage(tbodyId, page) {
  // Re-render the page — find the render function for this table
  const renderMap = {
    't-ventes': renderSales,'t-prods': renderProducts,'t-stock': renderStock,
    't-cli': renderCustomers,'t-treso': renderTreasury,'t-dep': renderExpenses,
    't-emp': renderEmployees,'t-fourn': renderSuppliers,'t-retours': renderReturns,
    't-ach-commandes': renderOrders,'t-ach-factures': renderPurchaseInvoices,'t-journal': renderAccounting,
  };
  currentPage[tbodyId] = page;
  if(renderMap[tbodyId]) renderMap[tbodyId]();
}

// Helper: build paginated tbody + pager wrapper
function renderPaginatedTable(tbodyId, rowsHtml, emptyMsg='No items', cols=5) {
  const tbody = g(tbodyId);
  const pager = g(tbodyId+'-pager');
  if(!tbody) return;
  if(rowsHtml.length===0){
    tbody.innerHTML = emptyR(cols, emptyMsg);
    if(pager) pager.innerHTML='';
    return;
  }
  const page = currentPage[tbodyId]||1;
  paginate(tbodyId, rowsHtml, page);
}


/* ════════════════════════════════════════════
   TRI COLONNES
════════════════════════════════════════════ */
let sortState = {}; // {tbodyId: {col, asc}}

function sortTable(tbodyId, col) {
  const prev = sortState[tbodyId] || {};
  const asc = prev.col === col ? !prev.asc : true;
  sortState[tbodyId] = {col, asc};
  // Update header arrows
  const tbl = g(tbodyId)?.closest('table');
  if(tbl) tbl.querySelectorAll('th').forEach((th,i)=>{
    th.querySelector('.sort-arrow')?.remove();
    if(i===col){
      const sp=document.createElement('span');
      sp.className='sort-arrow';
      sp.style.cssText='margin-left:4px;font-size:10px;color:#16a34a';
      sp.textContent=asc?'▲':'▼';
      th.appendChild(sp);
    }
  });
  // Sort rows
  const rows = Array.from(g(tbodyId)?.querySelectorAll('tr')||[]);
  rows.sort((a,b)=>{
    const A=(a.cells[col]?.textContent||'').trim().replace(/[\s,]/g,'');
    const B=(b.cells[col]?.textContent||'').trim().replace(/[\s,]/g,'');
    const nA=parseFloat(A), nB=parseFloat(B);
    if(!isNaN(nA)&&!isNaN(nB)) return asc?nA-nB:nB-nA;
    return asc?A.localeCompare(B,'fr'):B.localeCompare(A,'fr');
  });
  const tbody=g(tbodyId);
  if(tbody) rows.forEach(r=>tbody.appendChild(r));
}

// Make table headers sortable — call after any render
function makeSortable(tbodyId) {
  const tbody = g(tbodyId);
  if(!tbody) return;
  const ths = tbody.closest('table')?.querySelectorAll('thead th');
  if(!ths) return;
  ths.forEach((th,i)=>{
    th.style.cursor='pointer';
    th.onclick = ()=>sortTable(tbodyId, i);
  });
}


/* ════════════════════════════════════════════
   CUSTOMER HISTORY
════════════════════════════════════════════ */
function showClientHistory(i){
  const cli=db.clients[i];
  sg('cli-hist-title','History — '+cli.nom);
  const facs=db.factures.filter(f=>f.client===cli.nom);
  const payments=(db.reglements_clients||[]).filter(r=>r.clientId===cli.id);
  const total=facs.reduce((a,f)=>a+f.montant,0);
  const paid=facs.filter(f=>f.statut==='Paid');
  g('cli-hist-kpis').innerHTML=`
    <div class="km"><div class="km-label">Total purchases</div><div class="km-val" style="color:#16a34a">${money(total)}</div></div>
    <div class="km"><div class="km-label">Paid invoices</div><div class="km-val">${paid.length}/${facs.length}</div></div>
    <div class="km"><div class="km-label">Balance due</div><div class="km-val" style="color:${cli.solde>0?'#ef4444':'#16a34a'}">${money(cli.solde)}</div></div>
  `;
  const rows=[
    ...facs.map(f=>({date:f.date,html:`<tr>
      <td class="mono">${esc(fmtDate(f.date))}</td>
      <td class="bold mono">${esc(f.num)}</td>
      <td class="mono" style="font-weight:600">${money(f.montant)}</td>
      <td>${esc(f.mode||'—')}</td>
      <td><span class="badge ${f.statut==='Paid'?'b-green':f.statut==='Cancelled'?'b-red':'b-amber'}">${esc(f.statut)}</span></td>
    </tr>`})),
    ...payments.map(r=>({date:r.date,html:`<tr><td class="mono">${esc(fmtDate(r.date))}</td><td class="bold mono">${esc(r.ref)}</td><td class="mono" style="font-weight:600;color:#16a34a">${money(r.montant)}</td><td>${esc(r.mode)}</td><td><span class="badge b-green">Payment</span></td></tr>`}))
  ].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  g('t-cli-hist').innerHTML=rows.map(r=>r.html).join('')||`<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No transactions for this customer</td></tr>`;
  openM('m-cli-hist');
}


/* ════════════════════════════════════════════
   PRODUCT MOVEMENT HISTORY
════════════════════════════════════════════ */
function showProductHistory(i){
  const p=db.produits[i];
  sg('prod-hist-title','Movements — '+p.nom);
  // Build movements from invoices (stock out) + received orders (stock in)
  const sorties=[];
  db.factures.filter(f=>f.statut==='Paid').forEach(f=>{
    (f.lignes||[]).forEach(l=>{
      if(l.d===p.nom||l.desc===p.nom){
        sorties.push({date:f.date,type:'Out',qty:-(l.q||l.qte||0),ref:f.num,color:'#ef4444'});
      }
    });
  });
  const entrees=[];
  (db.commandes||[]).filter(cmd=>cmd.statut==='Received').forEach(cmd=>{
    (cmd.lignes||[]).forEach(l=>{
      if(l.d===p.nom){
        entrees.push({date:cmd.date,type:'In',qty:+(l.q||0),ref:cmd.num,color:'#16a34a'});
      }
    });
  });
  const all=[...entrees,...sorties].sort((a,b)=>b.date.localeCompare(a.date));
  const totalE=entrees.reduce((a,m)=>a+m.qty,0);
  const totalS=Math.abs(sorties.reduce((a,m)=>a+m.qty,0));
  g('prod-hist-kpis').innerHTML=`
    <div class="km"><div class="km-label">Current stock</div><div class="km-val" style="color:${p.stk===0?'#ef4444':p.stk<=p.min?'#f59e0b':'#16a34a'}">${p.stk}</div></div>
    <div class="km"><div class="km-label">Minimum stock</div><div class="km-val">${p.min}</div></div>
    <div class="km"><div class="km-label">Total in</div><div class="km-val" style="color:#16a34a">+${totalE}</div></div>
    <div class="km"><div class="km-label">Total out</div><div class="km-val" style="color:#ef4444">-${totalS}</div></div>
  `;
  let runningStock=p.stk;
  g('t-prod-hist').innerHTML=all.length
    ?all.map(m=>{const stk=runningStock;runningStock-=m.qty;return`<tr>
      <td class="mono">${esc(fmtDate(m.date))}</td>
      <td><span class="badge ${m.type==='In'?'b-green':'b-red'}">${m.type}</span></td>
      <td style="font-weight:700;color:${m.color}">${m.qty>0?'+':''}${m.qty}</td>
      <td class="mono" style="font-size:11px;color:#64748b">${esc(m.ref)}</td>
      <td class="mono">${stk}</td>
    </tr>`;}).join('')
    :`<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No movements recorded</td></tr>`;
  openM('m-prod-hist');
}


/* ════════════════════════════════════════════
   PRODUCT CSV IMPORT
════════════════════════════════════════════ */
let _csvParsed = [];

function downloadCSVTemplate(){
  const csv='name,reference,category,stock,min_stock,cost_price,selling_price\nLong-grain rice 10kg,RIC-001,Food,100,20,145.00,179.99\nSunflower oil 2L,OIL-002,Food,50,20,62.00,79.99';
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='kinta-product-template.csv';a.click();
  toast('Template downloaded','green');
}

function previewCSV(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=(e)=>{
    const lines=e.target.result.split('\n').map(l=>l.trim()).filter(Boolean);
    if(lines.length<2){toast('CSV file empty or invalid','red');return;}
    const headers=lines[0].split(',').map(h=>h.trim().replace(/"/g,''));
    _csvParsed=[];
    for(let i=1;i<lines.length;i++){
      const vals=lines[i].split(',').map(v=>v.trim().replace(/"/g,''));
      if(vals.length<3)continue;
      _csvParsed.push({
        nom:vals[0]||'',ref:vals[1]||'REF-'+uid(),cat:categoryKey(vals[2])||'Other',
        stk:parseInt(vals[3])||0,min:parseInt(vals[4])||10,
        pa:toBase(parseFloat(vals[5])||0),pv:toBase(parseFloat(vals[6])||0),bc:'',scat:'',lot:'',exp:''
      });
    }
    sg('csv-count',String(_csvParsed.length));
    const prevTable=g('csv-prev-table');
    if(prevTable){
      const head='<tr style="background:#f8fafc">'+['Name','Ref','Category','Stock','Min','Purchase','Sale'].map(h=>`<th style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b">${h}</th>`).join('')+'</tr>';
      const rows=_csvParsed.slice(0,10).map(p=>`<tr><td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px">${p.nom}</td><td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px">${p.ref}</td><td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px">${p.cat}</td><td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;text-align:right">${p.stk}</td><td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;text-align:right">${p.min}</td><td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;text-align:right">${amt(p.pa)}</td><td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;text-align:right">${amt(p.pv)}</td></tr>`).join('');
      prevTable.innerHTML=head+rows+(_csvParsed.length>10?`<tr><td colspan="7" style="padding:5px 8px;font-size:11px;color:#94a3b8;text-align:center">...et ${_csvParsed.length-10} more</td></tr>`:'');
    }
    g('csv-preview').style.display='block';
    const btn=g('csv-import-btn');if(btn)btn.disabled=_csvParsed.length===0;
  };
  reader.readAsText(file,'UTF-8');
}

function importCSV(){
  if(!_csvParsed.length){toast('No products to import','red');return;}
  let added=0,updated=0;
  _csvParsed.forEach(p=>{
    const existing=db.produits.find(x=>x.ref===p.ref||x.nom===p.nom);
    if(existing){Object.assign(existing,p);updated++;}
    else{db.produits.push({id:'P'+uid(),...p});added++;}
  });
  renderProducts();renderStock();buildCats();buildPOS();saveAll();
  closeM('m-import-csv');_csvParsed=[];
  const fi=g('csv-file');if(fi)fi.value='';
  g('csv-preview').style.display='none';
  const btn=g('csv-import-btn');if(btn)btn.disabled=true;
  toast(`Import successful: ${added} added, ${updated} updated`,'green');
}


/* ════════════════════════════════════════════
   ACCOUNTING — TABS + TRIAL BALANCE + GENERAL LEDGER + VAT
════════════════════════════════════════════ */
function switchAccountingTab(tab){
  ['journal','balance','grandlivre','tva','bilan'].forEach(t=>{
    const btn=g('ctab-'+t),cont=g('ctab-content-'+t);
    if(btn)btn.classList.toggle('on',t===tab);
    if(cont)cont.style.display=t===tab?'':'none';
  });
  if(tab==='balance')renderBalance();
  else if(tab==='grandlivre')renderGeneralLedger();
  else if(tab==='tva')renderTVA();
  else if(tab==='bilan')renderAccounting();
  else renderAccounting();
}

function buildAllEntries(){
  const ecr=[];
  // Sales
  db.factures.filter(f=>f.statut==='Paid').forEach(f=>{
    ecr.push({date:f.date,lib:f.num+' — '+f.client,compte:'70',intitule:'Sales',type:'credit',montant:f.montant});
    ecr.push({date:f.date,lib:f.num+' — till',compte:'57',intitule:'Till',type:'debit',montant:f.montant});
    const tva=vatIncluded(f.montant);
    ecr.push({date:f.date,lib:'VAT — '+f.num,compte:'44c',intitule:'VAT collected',type:'credit',montant:tva});
  });
  // Purchases
  db.depenses.forEach(d=>{
    const cpt=d.cat==='Stock purchase'?'60':d.cat==='Rent'?'62':d.cat==='Transport'?'63':d.cat==='Salaries'?'64':'61';
    ecr.push({date:d.date,lib:d.lib,compte:cpt,intitule:d.cat,type:'debit',montant:d.montant});
    ecr.push({date:d.date,lib:d.lib+' — till',compte:'57',intitule:'Till',type:'credit',montant:d.montant});
  });
  // Salaries
  db.employes.forEach(e=>{
    ecr.push({date:today(),lib:'Salary — '+e.prenom+' '+e.nom,compte:'64',intitule:'Staff costs',type:'debit',montant:e.salaire});
    const levies=employerLevies(e.salaire);
    ecr.push({date:today(),lib:'UIF + SDL — '+e.prenom+' '+e.nom,compte:'43',intitule:'UIF + SDL',type:'debit',montant:levies});
  });
  // Manual entries
  (db.journal||[]).forEach(e=>ecr.push(e));
  return ecr.sort((a,b)=>b.date.localeCompare(a.date));
}

function renderBalance(){
  const ecr=buildAllEntries();
  const comptes={
    '57':{intitule:'Till'},
    '52':{intitule:'Bank'},
    '70':{intitule:'Sales of goods'},
    '60':{intitule:"Purchases of goods"},
    '61':{intitule:"Operating expenses"},
    '62':{intitule:'Rent & rental charges'},
    '63':{intitule:'Transport & travel'},
    '64':{intitule:'Staff costs'},
    '43':{intitule:'Employer UIF + SDL'},
    '44c':{intitule:'VAT collected'},
    '44d':{intitule:'Deductible VAT'},
    '40':{intitule:'Supplier debts'},
    '41':{intitule:'Customer receivables'},
  };
  // Sum per account
  Object.keys(comptes).forEach(k=>{comptes[k].debit=0;comptes[k].credit=0;});
  ecr.forEach(e=>{
    const cpt=comptes[e.compte];
    if(!cpt){comptes[e.compte]={intitule:e.compte,debit:0,credit:0};}
    if(e.type==='debit')comptes[e.compte].debit+=e.montant;
    else comptes[e.compte].credit+=e.montant;
  });
  const rows=Object.entries(comptes).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>{
    const sd=Math.max(0,v.debit-v.credit);
    const sc=Math.max(0,v.credit-v.debit);
    return `<tr>
      <td><span class="badge b-gray">${k}</span></td>
      <td class="bold">${v.intitule}</td>
      <td class="mono">${v.debit>0?money(v.debit):'—'}</td>
      <td class="mono">${v.credit>0?money(v.credit):'—'}</td>
      <td class="mono" style="color:#ef4444">${sd>0?money(sd):'—'}</td>
      <td class="mono" style="color:#16a34a">${sc>0?money(sc):'—'}</td>
    </tr>`;
  });
  const tbody=g('t-balance');
  if(tbody)tbody.innerHTML=rows.join('')||'<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">No entries</td></tr>';
}

function renderGeneralLedger(){
  const ecr=buildAllEntries();
  const filter=gv('gl-compte-filter')||'';
  const filtered=filter?ecr.filter(e=>e.compte===filter||e.compte.startsWith(filter)):ecr;
  let cumul=0;
  const rows=filtered.map(e=>{
    cumul+=e.type==='debit'?e.montant:-e.montant;
    return `<tr>
      <td class="mono">${esc(fmtDate(e.date))}</td>
      <td><span class="badge b-gray">${esc(e.compte)}</span></td>
      <td class="bold">${esc(e.lib)}</td>
      <td class="mono" style="color:#ef4444">${e.type==='debit'?money(e.montant):'—'}</td>
      <td class="mono" style="color:#16a34a">${e.type==='credit'?money(e.montant):'—'}</td>
      <td class="mono" style="font-weight:700;color:${cumul>=0?'#16a34a':'#ef4444'}">${money(Math.abs(cumul))} ${cumul>=0?'D':'C'}</td>
    </tr>`;
  });
  const tbody=g('t-grandlivre');
  if(tbody)tbody.innerHTML=rows.join('')||'<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">No entries for this account</td></tr>';
}

function renderTVA(){
  const ca=db.factures.filter(f=>f.statut==='Paid').reduce((a,f)=>a+f.montant,0);
  const tvaRate=db.settings.tva||15;
  const tvaC=Math.round(ca*tvaRate/100/(1+tvaRate/100));
  const achats=db.depenses.filter(d=>d.cat==='Stock purchase').reduce((a,d)=>a+d.montant,0);
  const tvaD=Math.round(achats*tvaRate/100/(1+tvaRate/100));
  const nette=Math.max(0,tvaC-tvaD);
  sg('tva-collectee',money(tvaC));sg('tva-deductible',money(tvaD));sg('tva-nette',money(nette));
}

/* ════════════════════════════════════════════
   PATCH genReport — Add trial balance, general ledger, VAT
════════════════════════════════════════════ */
const __origGenReport = genReport;
window.genReport = function(type){
  const s=db.settings, col=s.color||'#16a34a';
  if(type==='balance'){
    const ecr=buildAllEntries();
    const comptes={};
    ecr.forEach(e=>{
      if(!comptes[e.compte])comptes[e.compte]={intitule:e.intitule||e.compte,debit:0,credit:0};
      if(e.type==='debit')comptes[e.compte].debit+=e.montant;
      else comptes[e.compte].credit+=e.montant;
    });
    const rows=Object.entries(comptes).sort().map(([k,v])=>{
      const sd=Math.max(0,v.debit-v.credit),sc=Math.max(0,v.credit-v.debit);
      return [k,v.intitule,v.debit>0?money(v.debit):'—',v.credit>0?money(v.credit):'—',sd>0?money(sd):'—',sc>0?money(sc):'—'];
    });
    const html=buildExportHeader('Trial Balance','OHADA — '+appNow().toLocaleDateString(LOCALE,{month:'long',year:'numeric'}),col)+buildExportTable(['Account','Account name','Debit','Credit','Debit balance','Credit balance'],rows,col)+buildExportFooter();
    openExportPDF(html,'kinta-balance-'+today());
    toast('Trial balance — Ctrl+P to print/PDF','green');return;
  }
  if(type==='general-ledger'){
    const ecr=buildAllEntries();
    let cumul=0;
    const rows=ecr.map(e=>{cumul+=e.type==='debit'?e.montant:-e.montant;return[fmtDate(e.date),e.compte,e.lib,e.type==='debit'?money(e.montant):'—',e.type==='credit'?money(e.montant):'—',money(Math.abs(cumul))+' '+(cumul>=0?'D':'C')];});
    const html=buildExportHeader('General ledger','General journal',col)+buildExportTable(['Date','Account','Label','Debit','Credit','Running balance'],rows,col)+buildExportFooter();
    openExportPDF(html,'kinta-general-ledger-'+today());
    toast('General ledger — Ctrl+P to print/PDF','green');return;
  }
  if(type==='vat'){
    const ca=db.factures.filter(f=>f.statut==='Paid').reduce((a,f)=>a+f.montant,0);
    const tvaRate=db.settings.tva||15;
    const tvaC=Math.round(ca*tvaRate/100/(1+tvaRate/100));
    const achats=db.depenses.filter(d=>d.cat==='Stock purchase').reduce((a,d)=>a+d.montant,0);
    const tvaD=Math.round(achats*tvaRate/100/(1+tvaRate/100));
    const nette=Math.max(0,tvaC-tvaD);
    const mois=appNow().toLocaleDateString(LOCALE,{month:'long',year:'numeric'});
    const kpis=[{label:'VAT collected',value:money(tvaC),color:col},{label:'Deductible VAT',value:money(tvaD),color:'#3b82f6'},{label:'Net VAT payable',value:money(nette),color:'#a855f7'}];
    const rows=[['Sales base excl. tax',money(Math.round(ca-tvaC)),money(tvaC)],['Purchases base excl. tax',money(Math.round(achats-tvaD)),money(tvaD)],['NET VAT PAYABLE','',money(nette)]];
    const html=buildExportHeader('VAT return','Period: '+mois+' · SARS',col)+buildKPICards(kpis,col)+buildExportTable(['Item','Base excl. tax','VAT ('+tvaRate+'%)'],rows,col)+'<div class="ab-amber" style="padding:12px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:13px;margin-top:16px">Payable to SARS (VAT201) by the 25th of next month.</div>'+buildExportFooter();
    openExportPDF(html,'kinta-vat-'+today());
    toast('VAT return — Ctrl+P for PDF','green');return;
  }
  __origGenReport(type);
};

/* ════════════════════════════════════════════
   PATCH 11 — PAYSLIP PDF
════════════════════════════════════════════ */
function generatePayslip(i){
  const e=db.employes[i];const s=db.settings;const col=s.color||'#16a34a';
  const brut=e.salaire;const uif=Math.round(brut*0.01);const net=brut-uif;
  const mois=appNow().toLocaleDateString(LOCALE,{month:'long',year:'numeric'});
  const html=buildExportHeader('Payslip','Period: '+mois,col)+`
    <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:20px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><div style="font-size:11px;color:#94a3b8;margin-bottom:3px">EMPLOYEE</div><div style="font-size:16px;font-weight:700">${e.prenom} ${e.nom}</div><div style="font-size:13px;color:#64748b">${e.poste}</div><div style="font-size:12px;color:#94a3b8">Hired on ${esc(fmtDate(e.date))}</div></div>
      <div style="text-align:right"><div style="font-size:11px;color:#94a3b8;margin-bottom:3px">EMPLOYER</div><div style="font-size:14px;font-weight:700">${s.nom||'—'}</div><div style="font-size:12px;color:#64748b">${s.adresse||''}</div><div style="font-size:12px;color:#94a3b8">Reg. no.: ${s.rccm||'—'}</div></div>
    </div>
    `+buildExportTable(['Item','Base','Rate','Amount'],[
    ['Basic gross salary',money(brut),'—',money(brut)],
    ['UIF (employee share)',money(brut),'1%','-'+money(uif)],
    ['','','',''],
    ['NET PAY','','',money(net)],
  ],col)+`
    <div style="background:${col};color:#fff;padding:16px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-top:20px">
      <div style="font-size:14px;font-weight:600">Net pay</div>
      <div style="font-size:24px;font-weight:900">${money(net)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:30px;padding-top:20px;border-top:1px solid #e2e8f0">
      <div><div style="font-size:11px;color:#94a3b8;margin-bottom:40px">Employer signature</div><div style="border-top:1px solid #374151;font-size:11px;color:#374151;padding-top:5px">${s.nom||'Employer'}</div></div>
      <div><div style="font-size:11px;color:#94a3b8;margin-bottom:40px">Employee signature</div><div style="border-top:1px solid #374151;font-size:11px;color:#374151;padding-top:5px">${e.prenom} ${e.nom}</div></div>
    </div>`+buildExportFooter();
  openExportPDF(html,'payslip-'+e.nom+'-'+today());
  toast('Payslip — Ctrl+P for PDF','green');
}


/* ════════════════════════════════════════════
   DYNAMIC USER MANAGEMENT
════════════════════════════════════════════ */
function getUsers(){
  return db.settings.users || [];
}
async function loadUsersServer(){
  if(!API_TOKEN||CU?.role!=='admin')return;
  try{const result=await apiCall('GET','/users');db.settings.users=result.users||[];renderUsers();renderSetupGuide();}catch(e){toast(e.message,'amber');}
}
async function deleteRemoteUser(id){
  try{await apiCall('DELETE','/users/'+encodeURIComponent(id));await loadUsersServer();toast('User deactivated','amber');}
  catch(e){toast(e.message,'red');}
}
function renderUsers(){
  const users=getUsers();
  const tbody=g('t-users');if(!tbody)return;
  const roleLabels={admin:'Administrator',cashier:'Cashier',salesperson:'Salesperson',accountant:'Accountant'};
  const roleBadges={admin:'b-blue',cashier:'b-green',salesperson:'b-amber',accountant:'b-purple'};
  tbody.innerHTML=users.map((u,i)=>`<tr>
    <td class="bold">${u.login}</td>
    <td><span class="badge ${roleBadges[u.role]||'b-gray'}">${roleLabels[u.role]||u.role}</span></td>
    <td><span class="badge ${u.role==='admin'?'b-green':'b-amber'}">${u.role==='admin'?'Full':'Limited'}</span></td>
    <td><div style="display:flex;gap:5px">
      ${CU&&CU.username===u.login?`<button class="btn btn-outline btn-xs" onclick="openM('m-chg-mdp')">${icon('key')} Password</button>`:''}
      ${CU&&CU.username!==u.login?`<button class="btn btn-danger btn-xs" onclick="confirmDo('Deactivate user ${u.login}?',()=>deleteRemoteUser('${u.id}'))">×</button>`:''}
    </div></td>
  </tr>`).join('');
}
async function saveUser(){
  const login=gv('u-login').trim(),pass=gv('u-pass'),role=gv('u-role');
  if(!login||!pass||pass.length<8){toast('Login and password (min 8 chars) required','red');return;}
  try{await apiCall('POST','/users',{login,password:pass,role,nom:login});closeM('m-user');await loadUsersServer();
    ['u-login','u-pass'].forEach(id=>{const e=g(id);if(e)e.value='';});renderSetupGuide();toast('User saved — step complete ✓','green');}
  catch(e){toast(e.message,'red');}
}
async function changePassword(){
  const old=gv('mdp-old'),nw=gv('mdp-new'),conf=gv('mdp-conf');
  if(!CU){toast('Not signed in','red');return;}
  if(nw.length<8){toast('New password too short (min 8 chars)','red');return;}
  if(nw!==conf){toast('Passwords do not match','red');return;}
  try{await apiCall('POST','/auth/change-password',{old_password:old,new_password:nw});closeM('m-chg-mdp');
    ['mdp-old','mdp-new','mdp-conf'].forEach(id=>{const e=g(id);if(e)e.value='';});toast('Password changed ✓','green');}
  catch(e){toast(e.message,'red');}
}

// Server authentication: no password is kept in the browser.
window.login = async function(){
  const u=gv('auth-user').trim(), p=gv('auth-pass');
  const err=g('auth-err');
  const button=document.querySelector('.auth-btn');
  if(!u||!p){err.textContent='Username and password required.';err.style.display='block';return;}
  try{
    if(button){button.disabled=true;button.textContent='Signing in…';}
    const result=await apiCall('POST','/auth/login',{login:u,password:p});
    API_TOKEN=result.token;sessionStorage.setItem(TOKEN_KEY,API_TOKEN);
    const user=result.user;
    CU={id:user.id,username:user.login,role:user.role,label:user.nom||user.login,initials:(user.nom||user.login||'U')[0].toUpperCase()};
    err.style.display='none';g('auth-screen').style.display='none';g('app').style.display='flex';
    resetSessionTimer();await initApp();
  }catch(e){
    err.textContent=e.message;err.style.display='block';
    const inp=g('auth-user');if(inp){inp.style.borderColor='#ef4444';setTimeout(()=>inp.style.borderColor='',1500);}
  }finally{if(button){button.disabled=false;button.textContent='Sign in';}}
};

function toggleMobileMenu(){document.body.classList.toggle('sidebar-open');}
function closeMobileMenu(){document.body.classList.remove('sidebar-open');}
async function refreshApp(){
  const button=document.querySelector('[onclick="refreshApp()"]');
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  try{await persistServer();location.reload();}
  catch(_){location.reload();}
}
function togglePasswordVisibility(){
  const input=g('auth-pass'),button=document.querySelector('.password-toggle');if(!input||!button)return;
  const visible=input.type==='text';input.type=visible?'password':'text';
  button.classList.toggle('visible',!visible);button.setAttribute('aria-pressed',String(!visible));
  button.setAttribute('aria-label',visible?'Show password':'Hide password');
  button.title=visible?'Show password':'Hide password';input.focus();
}

/* ════════════════════════════════════════════
   INTERNAL MESSAGING
════════════════════════════════════════════ */
let messageContact='general',messageAttachment=null,messageUsers=[];
const msgEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const msgInitials=value=>String(value||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase();
function openMessenger(){
  if(!canAccessPage('messagerie')){toast('Messaging is for managers, cashiers and accountants only','red');return;}
  openM('m-messagerie');loadMessenger();setTimeout(()=>g('msg-content')?.focus(),150);
}
function messageDate(value){
  if(!value)return '';
  const date=new Date(String(value).replace(' ','T')+(String(value).includes('Z')?'':'Z'));
  return Number.isNaN(date.getTime())?String(value):date.toLocaleString(LOCALE,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
async function loadMessageUnread(){
  if(!API_TOKEN||!canAccessPage('messagerie'))return;
  try{const result=await apiCall('GET','/messagerie/utilisateurs'),badge=g('msg-nav-badge'),count=Number(result.total_non_lus||0);if(badge){badge.textContent=count>99?'99+':String(count);badge.style.display=count?'inline-flex':'none';}}
  catch(_){}
}
async function loadMessenger(refresh=false){
  if(!API_TOKEN||!canAccessPage('messagerie'))return;
  try{
    const result=await apiCall('GET','/messagerie/utilisateurs');messageUsers=result.utilisateurs||[];
    const general=g('msg-unread-general');if(general){general.textContent=result.general_non_lus||'';general.style.display=result.general_non_lus?'inline-block':'none';}
    const list=g('msg-contact-list');if(list)list.innerHTML=messageUsers.map(user=>`<button class="messenger-contact ${messageContact===user.id?'on':''}" type="button" onclick="selectMessageContact('${user.id}',this)"><span class="messenger-avatar">${msgEsc(msgInitials(user.nom||user.login))}</span><span><strong>${msgEsc(user.nom||user.login)}</strong><small>${msgEsc(user.role)}</small></span><b style="display:${Number(user.non_lus)?'block':'none'}">${Number(user.non_lus)||''}</b></button>`).join('')||'<div class="messenger-empty">No other active users.</div>';
    const badge=g('msg-nav-badge'),count=Number(result.total_non_lus||0);if(badge){badge.textContent=count>99?'99+':String(count);badge.style.display=count?'inline-flex':'none';}
    document.querySelectorAll('.messenger-contact').forEach(button=>button.classList.remove('on'));
    if(messageContact==='general')g('msg-contact-general')?.classList.add('on');
    else [...document.querySelectorAll('#msg-contact-list .messenger-contact')].find(button=>button.getAttribute('onclick')?.includes(messageContact))?.classList.add('on');
    await loadMessages(refresh);
  }catch(e){toast('Messages: '+e.message,'red');}
}
async function selectMessageContact(contact,button){
  messageContact=contact;document.querySelectorAll('.messenger-contact').forEach(item=>item.classList.remove('on'));button?.classList.add('on');
  const user=messageUsers.find(item=>item.id===contact),title=user?(user.nom||user.login):'General channel';
  sg('msg-chat-title',title);sg('msg-chat-subtitle',user?('Private conversation · '+user.role):'Visible to the whole team');sg('msg-chat-avatar',user?msgInitials(title):'#');
  g('msg-chat-avatar')?.classList.toggle('general',!user);
  try{await apiCall('PATCH','/messagerie/lire',{contact});}catch(_){}
  await loadMessages();await loadMessageUnread();
}
async function loadMessages(preserveScroll=false){
  const box=g('msg-messages');if(!box)return;
  try{
    const result=await apiCall('GET','/messagerie/messages?contact='+encodeURIComponent(messageContact)),messages=result.messages||[],nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
    box.innerHTML=messages.map(message=>{
      const mine=message.expediteur_id===CU?.id||message.expediteur_login===CU?.username,body=msgEsc(message.contenu).replace(/\n/g,'<br>');
      const attachment=message.piece_data?`<a class="message-file-link" href="${message.piece_data}" download="${msgEsc(message.piece_nom||'attachment')}">${icon('clip')} ${msgEsc(message.piece_nom||'Attachment')}</a>`:'';
      return `<div class="message-row ${mine?'mine':''}"><article class="message-bubble ${message.epingle?'pinned':''}">${messageContact==='general'?`<div class="message-author">${msgEsc(message.expediteur_nom||message.expediteur_login)}</div>`:''}<div>${body}</div>${message.ticket_ref?`<span class="message-ticket">${icon('receipt')} ${msgEsc(message.ticket_ref)}</span>`:''}${attachment}<div class="message-meta"><span>${message.epingle?icon('pin')+' ':''}${messageDate(message.created_at)}</span>${mine&&messageContact!=='general'?`<span>${Number(message.lectures)?'✓✓ Read':'✓ Sent'}</span>`:''}</div><div class="message-actions">${CU?.role==='admin'?`<button type="button" onclick="toggleMessagePin('${message.id}',${message.epingle?0:1})">${message.epingle?'Unpin':'Pin'}</button>`:''}<button type="button" onclick="archiveMessage('${message.id}')">Archive</button></div></article></div>`;
    }).join('')||'<div class="messenger-empty">No messages. Start the conversation.</div>';
    if(!preserveScroll||nearBottom)box.scrollTop=box.scrollHeight;
    await apiCall('PATCH','/messagerie/lire',{contact:messageContact});
  }catch(e){box.innerHTML='<div class="messenger-empty">'+msgEsc(e.message)+'</div>';}
}
function prepareMessageAttachment(input){
  const file=input.files?.[0];if(!file){messageAttachment=null;return;}
  if(file.size>1024*1024){toast('The attachment must not exceed 1 MB','red');input.value='';return;}
  const reader=new FileReader();reader.onload=()=>{messageAttachment={nom:file.name,type:file.type,data:reader.result};const preview=g('msg-attachment-preview');if(preview){preview.style.display='block';preview.innerHTML=icon('clip')+' '+msgEsc(file.name)+' <button type="button" onclick="clearMessageAttachment()">Remove</button>';}};reader.readAsDataURL(file);
}
function clearMessageAttachment(){messageAttachment=null;const input=g('msg-file');if(input)input.value='';const preview=g('msg-attachment-preview');if(preview){preview.style.display='none';preview.innerHTML='';}}
async function sendMessage(event){
  event?.preventDefault?.();const contenu=gv('msg-content').trim(),button=g('msg-send');if(!contenu&&!messageAttachment){toast('Write a message or attach a file','amber');return;}
  if(button)button.disabled=true;
  try{await apiCall('POST','/messagerie/messages',{contenu,destinataire_id:messageContact==='general'?null:messageContact,ticket_ref:gv('msg-ticket-ref').trim(),attachment:messageAttachment});g('msg-content').value='';g('msg-ticket-ref').value='';clearMessageAttachment();await loadMessages();}
  catch(e){toast(e.message,'red');}finally{if(button)button.disabled=false;g('msg-content')?.focus();}
}
async function archiveMessage(id){try{await apiCall('PATCH','/messagerie/messages/'+encodeURIComponent(id)+'/archiver',{});await loadMessages();toast('Message archived for you','green');}catch(e){toast(e.message,'red');}}
async function toggleMessagePin(id,epingle){try{await apiCall('PATCH','/messagerie/messages/'+encodeURIComponent(id)+'/epingler',{epingle:!!epingle});await loadMessages();}catch(e){toast(e.message,'red');}}

if(location.protocol==='file:'){
  window.addEventListener('DOMContentLoaded',()=>{
    const err=g('auth-err');if(err){err.textContent='Kinta must be opened at http://localhost:3000. Start the backend first.';err.style.display='block';}
  });
}

if('serviceWorker' in navigator&&location.protocol!=='file:'){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
}

// Patch initApp to render users
const __origInitApp2 = initApp;
window.initApp = async function(){
  await loadTestClock();
  await __origInitApp2();
  applyRolePermissions();
  if(CU?.role==='cashier')nav('caisse',document.querySelector('.sb-item[data-p="caisse"]'));
  else if(!canAccessPage('dashboard'))nav(ROLE_ACCESS[CU?.role]?.[0]||'dashboard');
  await loadCashSession();
  await loadUsersServer();
  await loadMessageUnread();
  if(!window._kintaMessagePoll)window._kintaMessagePoll=setInterval(()=>{
    loadMessageUnread();
    if(g('m-messagerie')?.classList.contains('open'))loadMessages(true);
  },15000);
  // Add change password btn to topbar user
};

async function restoreSession(){
  if(!API_TOKEN)return;
  try{
    const result=await apiCall('GET','/auth/me'),user=result.user;
    CU={id:user.id,username:user.login,role:user.role,label:user.nom||user.login,initials:(user.nom||user.login||'U')[0].toUpperCase()};
    g('auth-screen').style.display='none';g('app').style.display='flex';resetSessionTimer();await initApp();
  }catch(_){API_TOKEN='';sessionStorage.removeItem(TOKEN_KEY);}
}
window.addEventListener('DOMContentLoaded',()=>{configureAuthScreen();restoreSession();});


/* ════════════════════════════════════════════
   LEAVE & ABSENCES
════════════════════════════════════════════ */
if(!db.conges)db.conges=[];

function switchEmpTab(tab){
  ['employes','conges'].forEach(t=>{
    const btn=g('etab-'+t),cont=g('etab-content-'+t);
    if(btn)btn.classList.toggle('on',t===tab);
    if(cont)cont.style.display=t===tab?'':'none';
  });
  if(tab==='conges')renderLeave();
  else renderEmployees();
}

function renderLeave(){
  if(!db.conges)db.conges=[];
  // Populate emp select
  const sel=g('cg-emp');
  if(sel)sel.innerHTML=db.employes.map(e=>`<option value="${esc(e.prenom+' '+e.nom)}">${esc(e.prenom+' '+e.nom)}</option>`).join('');
  const totalJours=db.conges.filter(cg=>cg.statut==='Approved').reduce((a,cg)=>{
    const d1=new Date(cg.debut),d2=new Date(cg.fin);
    return a+Math.max(0,Math.ceil((d2-d1)/(1000*60*60*24))+1);
  },0);
  const pending=db.conges.filter(cg=>cg.statut==='Pending').length;
  sg('cg-total',String(db.conges.length));sg('cg-jours',String(totalJours));sg('cg-pending',String(pending));
  g('t-conges').innerHTML=db.conges.map((cg,i)=>{
    const d1=new Date(cg.debut),d2=new Date(cg.fin);
    const jours=Math.max(0,Math.ceil((d2-d1)/(1000*60*60*24))+1);
    const emp=db.employes.find(e=>e.prenom+' '+e.nom===cg.emp);
    return `<tr>
      <td class="bold">${esc(cg.emp)}</td>
      <td style="font-size:12px;color:#64748b">${esc(emp?emp.poste:'—')}</td>
      <td><span class="badge b-blue">${esc(cg.type)}</span></td>
      <td class="mono">${esc(fmtDate(cg.debut))}</td>
      <td class="mono">${esc(fmtDate(cg.fin))}</td>
      <td><span class="badge ${cg.statut==='Approved'?'b-green':cg.statut==='Refused'?'b-red':'b-amber'}">${cg.statut}</span></td>
      <td style="text-align:center;font-weight:600">${jours} j</td>
      <td><div style="display:flex;gap:5px">
        ${cg.statut==='Pending'?`<button class="btn btn-success btn-xs" onclick="approveLeave(${i})">✓</button><button class="btn btn-danger btn-xs" onclick="refuseLeave(${i})">✕</button>`:''}
        <button class="btn btn-danger btn-xs" onclick="confirmDo('Delete?',()=>{db.conges.splice(${i},1);renderLeave();saveAll();})" title="Delete" aria-label="Delete">${icon('trash')}</button>
      </div></td>
    </tr>`;
  }).join('')||'<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:20px">No leave recorded</td></tr>';
}

function saveLeave(){
  const emp=gv('cg-emp'),debut=gv('cg-debut'),fin=gv('cg-fin');
  if(!emp||!debut||!fin){toast('Employee, start and end dates are required','red');return;}
  if(new Date(fin)<new Date(debut)){toast('The end date must be after the start date','red');return;}
  db.conges.unshift({id:'CG'+uid(),emp,type:gv('cg-type'),debut,fin,statut:gv('cg-statut'),motif:gv('cg-motif')});
  // Update presence if approved
  if(gv('cg-statut')==='Approved'){
    const e=db.employes.find(x=>x.prenom+' '+x.nom===emp);
    const d1=new Date(debut),d2=new Date(fin);
    const jours=Math.ceil((d2-d1)/(1000*60*60*24))+1;
    if(e&&e.pres>0)e.pres=Math.max(0,e.pres-Math.round(jours/30*100));
  }
  renderLeave();closeM('m-conge');saveAll();toast('Leave recorded','green');
  ['cg-debut','cg-fin','cg-motif'].forEach(id=>{const e=g(id);if(e)e.value='';});
}
function approveLeave(i){db.conges[i].statut='Approved';renderLeave();saveAll();toast('Leave approved','green');}
function refuseLeave(i){db.conges[i].statut='Refused';renderLeave();saveAll();toast('Leave refused','amber');}


/* ════════════════════════════════════════════
   SALE CANCELLATION
════════════════════════════════════════════ */
function cancelSale(i){
  confirmDo('Cancel this sale? Stock will be restored where possible.', ()=>{
    const f=db.factures[i];
    if(f.statut==='Cancelled')return;
    const ancien=f.statut;
    if(f.mode==='Credit'){toast('Credit sales must be settled through customer payments','amber');return;}
    f.statut='Cancelled';
    // Put the lines back into stock
    (f.lignes||[]).forEach(l=>{
      const p=db.produits.find(x=>x.nom===(l.d||l.desc));
      if(p) p.stk+=(l.q||l.qte||0);
    });
    // If it was paid → create a credit note as a treasury outflow
    if(ancien==='Paid'){
      db.mouvements.unshift({id:'MV'+uid(),date:today(),lib:'Credit note — cancellation '+f.num,type:'out',montant:f.montant,mode:'Cash'});
    }
    renderSales();renderStock();updateKPIs();updateAlerts();saveAll();
    toast('Sale '+f.num+' cancelled — stock restored','amber');
  });
}

/* ════════════════════════════════════════════
   KINTA v6.2 — CORRECTIFS MODULES
════════════════════════════════════════════ */
let _editingClient=-1, _payingClient=-1, _editingMovement=-1, _reportPeriod='mois';

function ensureV62Modals(){
  if(g('m-client-edit'))return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="m-client-edit"><div class="modal">
    <div class="modal-hdr"><div class="modal-title">Edit customer</div><button class="modal-close" onclick="closeM('m-client-edit')">×</button></div>
    <div class="fg"><label class="fl">Last name *</label><input class="fi" id="ce-nom"></div>
    <div class="frow"><div class="fg"><label class="fl">Phone</label><input class="fi" id="ce-tel"></div><div class="fg"><label class="fl">Email</label><input class="fi" id="ce-email" type="email"></div></div>
    <div class="frow"><div class="fg"><label class="fl">City</label><input class="fi" id="ce-ville"></div><div class="fg"><label class="fl">Type</label><select class="fs" id="ce-type"><option>Retailer</option><option>Wholesaler</option><option>Individual</option></select></div></div>
    <div class="frow"><div class="fg"><label class="fl">Credit line (R)</label><input class="fi" id="ce-credit" type="number" min="0"></div><div class="fg"><label class="fl">Balance due (payments only)</label><input class="fi" id="ce-solde" type="number" min="0" readonly></div></div>
    <div class="fg"><label class="fl">Address</label><textarea class="fi" id="ce-adr" rows="2"></textarea></div>
    <div class="modal-ftr"><button class="btn btn-outline" onclick="closeM('m-client-edit')">Cancel</button><button class="btn btn-green" onclick="saveClientEdit()">Save</button></div>
  </div></div>
  <div class="modal-overlay" id="m-client-payment"><div class="modal">
    <div class="modal-hdr"><div class="modal-title" id="client-payment-title">Record a payment</div><button class="modal-close" onclick="closeM('m-client-payment')">×</button></div>
    <div class="alert-box ab-green"><span>✓</span><div><div style="font-weight:600">Balance due</div><div id="client-payment-balance">${money(0)}</div></div></div>
    <div class="frow"><div class="fg"><label class="fl">Amount received (R) *</label><input class="fi" id="client-payment-amount" type="number" min="1"></div><div class="fg"><label class="fl">Date</label><input class="fi" id="client-payment-date" type="date"></div></div>
    <div class="fg"><label class="fl">Payment method</label><select class="fs" id="client-payment-mode"><option>Cash</option><option>E-wallet (SnapScan)</option><option>E-wallet (Zapper)</option><option>Bank transfer</option></select></div>
    <div class="fg"><label class="fl">Note</label><input class="fi" id="client-payment-note" placeholder="Optional reference or comment"></div>
    <div class="modal-ftr"><button class="btn btn-outline" onclick="closeM('m-client-payment')">Cancel</button><button class="btn btn-green" onclick="saveClientPayment()">Take payment</button></div>
  </div></div>
  <div class="modal-overlay" id="m-rapport-periode"><div class="modal">
    <div class="modal-hdr"><div class="modal-title">Custom period</div><button class="modal-close" onclick="closeM('m-rapport-periode')">×</button></div>
    <div class="frow"><div class="fg"><label class="fl">From</label><input class="fi" type="date" id="rp-du"></div><div class="fg"><label class="fl">To</label><input class="fi" type="date" id="rp-au"></div></div>
    <div class="modal-ftr"><button class="btn btn-outline" onclick="closeM('m-rapport-periode')">Cancel</button><button class="btn btn-green" onclick="applyCustomPeriod()">Apply</button></div>
  </div></div>`);
}

function editClient(i){
  ensureV62Modals();const c=db.clients[i];if(!c)return;_editingClient=i;
  ['nom','tel','email','ville','type','credit','solde','adr'].forEach(k=>{const el=g('ce-'+k);if(el)el.value=k==='credit'||k==='solde'?toInput(c[k]||0):c[k]??'';});
  openM('m-client-edit');
}
function saveClientEdit(){
  const c=db.clients[_editingClient], nom=gv('ce-nom').trim();
  if(!c||!nom){toast('Customer name is required','red');return;}
  const oldName=c.nom;
  Object.assign(c,{nom,tel:gv('ce-tel'),email:gv('ce-email'),ville:gv('ce-ville')||'Johannesburg',type:gv('ce-type'),credit:Math.max(0,parseFloat(gv('ce-credit'))||0),solde:Math.max(0,parseFloat(gv('ce-solde'))||0),adr:gv('ce-adr')});
  db.factures.forEach(f=>{if(f.client===oldName)f.client=nom;});
  saveAll();renderCustomers();buildPOS();closeM('m-client-edit');toast('Customer updated successfully','green');
}

function openClientPayment(i){
  ensureV62Modals();const c=db.clients[i];if(!c||Number(c.solde)<=0){toast('This customer has no balance due','blue');return;}
  _payingClient=i;sg('client-payment-title','Payment — '+c.nom);sg('client-payment-balance',money(c.solde));
  const amount=g('client-payment-amount');amount.value=toInput(c.solde);amount.max=toInput(c.solde);
  g('client-payment-date').value=today();g('client-payment-mode').value='Cash';g('client-payment-note').value='';openM('m-client-payment');
}
function saveClientPayment(){
  const c=db.clients[_payingClient],amount=capTo(roundMoney(Number(gv('client-payment-amount'))),Number(c?.solde)||0),date=gv('client-payment-date')||today(),mode=gv('client-payment-mode')||'Cash';
  if(!c||!Number.isFinite(amount)||amount<=0){toast('Enter a valid amount','red');return;}
  if(amount>Number(c.solde)){toast('The amount exceeds the balance due','red');return;}
  const ref='RCL-'+today().replace(/-/g,'')+'-'+uid();
  db.reglements_clients=db.reglements_clients||[];db.journal=db.journal||[];
  db.reglements_clients.unshift({id:'RCL'+uid(),ref,date,clientId:c.id,client:c.nom,montant:amount,mode,note:gv('client-payment-note'),user:CU?.label||'User'});
  c.solde=Math.max(0,Number(c.solde)-amount);
  let remaining=amount;
  db.factures.filter(f=>f.clientId===c.id&&f.statut==='On credit').slice().reverse().forEach(f=>{const applied=Math.min(remaining,Number(f.resteDu)||0);f.resteDu-=applied;remaining-=applied;if(f.resteDu===0)f.statut='Paid';});
  db.mouvements.unshift({id:'MV'+uid(),date,lib:'Customer payment '+c.nom,type:'in',montant:amount,mode,ref,clientId:c.id});
  db.journal.unshift({id:'J'+uid(),date,lib:'Customer payment '+c.nom,compte:'41',intitule:'Customer receivables',type:'credit',montant:amount,piece:ref});
  db.journal.unshift({id:'J'+uid(),date,lib:'Customer payment '+c.nom,compte:'57',intitule:'Till',type:'debit',montant:amount,piece:ref});
  saveAll();renderCustomers();updateAlerts();closeM('m-client-payment');toast('Payment of '+money(amount)+' received','green');
}

window.renderCustomers=function(){
  const rows=db.clients.map((c,i)=>{const pct=c.credit?Math.min(100,Math.round(c.solde/c.credit*100)):0;const pc=pct>=80?'#ef4444':pct>=50?'#f59e0b':'#16a34a';return `<tr>
    <td class="bold">${esc(c.nom)}</td><td class="mono">${esc(c.tel||'—')}</td><td>${esc(c.email||'—')}</td><td>${esc(c.ville||'—')}</td><td><span class="badge b-blue">${esc(c.type||'—')}</span></td>
    <td class="mono" style="color:${c.solde>0?'#ef4444':'#64748b'}">${c.solde>0?money(c.solde):'—'}</td>
    <td><div style="min-width:90px"><div class="prog"><div class="prog-f" style="width:${pct}%;background:${pc}"></div></div><div style="font-size:10px;color:#94a3b8;margin-top:2px">${fmt(Math.max(0,c.credit-c.solde))} available / ${money(c.credit)}</div></div></td>
    <td><div style="display:flex;gap:5px;flex-wrap:wrap">${c.solde>0?`<button class="btn btn-green btn-xs" onclick="openClientPayment(${i})">Take payment</button>`:''}<button class="btn btn-outline btn-xs" onclick="editClient(${i})">Edit</button><button class="btn btn-outline btn-xs" onclick="showClientHistory(${i})">History</button><button class="btn btn-danger btn-xs" onclick="confirmDo('Delete this customer?',()=>{db.clients.splice(${i},1);renderCustomers();saveAll();})">×</button></div></td></tr>`;});
  setTimeout(()=>makeSortable('t-cli'),50);renderPaginatedTable('t-cli',rows,'No customers',8);
};

function openTreasuryOperation(kind,i=-1){
  _editingMovement=i;const m=i>=0?db.mouvements[i]:null;openM('m-mouv');
  setMvT(kind==='out'?'out':kind==='transfer'?'transfer':m?.type||'in');
  g('mv-date').value=m?.date||today();g('mv-mont').value=m?toInput(m.montant):'';g('mv-lib').value=m?.lib||(kind==='transfer'?'Transfer between accounts':'');g('mv-mode').value=m?.mode||'Cash';
  g('mv-account').value=m?.account||treasuryAccountFromMode(m?.mode);
  g('mv-source').value=m?.sourceAccount||'till';g('mv-destination').value=m?.destinationAccount||'mobile';
  const title=g('m-mouv')?.querySelector('.modal-title');if(title)title.textContent=i>=0?'Edit transaction':kind==='transfer'?'New transfer':'New transaction';
}
window.setMvT=function(t){
  g('mv-type').value=t;const i=g('mv-in'),o=g('mv-out');
  i.className=t==='in'?'btn btn-success':'btn btn-outline';o.className=t==='out'?'btn btn-danger':'btn btn-outline';
  if(g('mv-transfer-wrap'))g('mv-transfer-wrap').style.display=t==='transfer'?'flex':'none';
  if(g('mv-account-wrap'))g('mv-account-wrap').style.display=t==='transfer'?'none':'block';
  if(g('mv-mode-wrap'))g('mv-mode-wrap').style.display=t==='transfer'?'none':'block';
};
window.saveMovement=function(){
  const lib=gv('mv-lib').trim(),mont=parseFloat(gv('mv-mont'))||0,type=gv('mv-type');
  if(!lib||mont<=0){toast('Description and amount required','red');return;}
  const source=gv('mv-source'),destination=gv('mv-destination'),account=gv('mv-account');
  if(type==='transfer'&&source===destination){toast('Choose two different accounts','red');return;}
  const balances=treasuryBalances(_editingMovement);
  const debitAccount=type==='transfer'?source:(type==='out'?account:null);
  if(debitAccount&&balances[debitAccount]<mont){toast('Insufficient balance in '+treasuryAccountLabel(debitAccount),'red');return;}
  const data={id:_editingMovement>=0?db.mouvements[_editingMovement].id:'MV'+uid(),date:gv('mv-date')||today(),lib,type,montant:mont,mode:type==='transfer'?'Internal transfer':gv('mv-mode'),account:type==='transfer'?undefined:account,sourceAccount:type==='transfer'?source:undefined,destinationAccount:type==='transfer'?destination:undefined};
  if(_editingMovement>=0)db.mouvements[_editingMovement]=data;else db.mouvements.unshift(data);
  _editingMovement=-1;saveAll();renderTreasury();closeM('m-mouv');['mv-lib','mv-mont'].forEach(id=>g(id).value='');toast('Transaction recorded','green');
};
function deleteMovement(i){confirmDo('Delete this transaction?',()=>{db.mouvements.splice(i,1);saveAll();renderTreasury();toast('Transaction deleted','amber');});}

function treasuryAccountFromMode(mode){const value=String(mode||'').toLowerCase();return value.includes('e-wallet')||value.includes('mobile')?'mobile':value.includes('bank transfer')||/\bbank\b(?! card)/.test(value)?'bank':'till';}
function syncTreasuryAccountFromMode(){if(g('mv-account'))g('mv-account').value=treasuryAccountFromMode(gv('mv-mode'));}
function treasuryAccountLabel(account){return account==='mobile'?'E-wallet':account==='bank'?'Bank':'Main till';}
function treasuryMovementAccounts(m){
  if(m.type==='transfer'){
    let source=m.sourceAccount,destination=m.destinationAccount;
    if(!source||!destination){const text=String(m.lib||'').toLowerCase();source='till';destination=text.includes('bank')?'bank':'mobile';}
    return {source,destination};
  }
  return {account:m.account||treasuryAccountFromMode(m.mode)};
}
function treasuryBalances(excludeIndex=-1){
  const balances={till:0,mobile:0,bank:0};
  db.mouvements.forEach((m,i)=>{if(i===excludeIndex)return;const amount=Number(m.montant)||0,a=treasuryMovementAccounts(m);
    if(m.type==='in')balances[a.account]+=amount;else if(m.type==='out')balances[a.account]-=amount;else if(m.type==='transfer'){balances[a.source]-=amount;balances[a.destination]+=amount;}
  });return balances;
}
function openTreasuryOptions(){const b=treasuryBalances();g('treso-options-balances').innerHTML=`<span>${icon('wallet')}</span><span><strong>Till:</strong> ${money(b.till)}<br><strong>E-wallet:</strong> ${money(b.mobile)}<br><strong>Bank:</strong> ${money(b.bank)}</span>`;openM('m-treso-options');}

async function closeManagedCash(id){
  try{
    const result=await apiCall('GET','/caisse/sessions?limit=200');
    const session=result.sessions.find(s=>s.id===id&&s.statut==='open');
    if(!session){toast('This till is already closed','amber');renderControl();return;}
    closingCashSession=session;
    const theoretical=Number(session.fonds_initial)+Number(session.ventes_especes);
    g('cash-counted').value=toInput(theoretical);
    g('cash-close-recap').innerHTML=`<span>${esc(session.utilisateur_nom)} · ${session.nombre_ventes} sale(s)<br>Expected cash: <strong>${money(theoretical)}</strong></span>`;
    openM('m-caisse-close');
  }catch(e){toast(e.message,'red');}
}

function accountTransactions(account){
  return db.mouvements.flatMap(m=>{
    const a=treasuryMovementAccounts(m);
    if(m.type==='transfer'){
      if(a.source!==account&&a.destination!==account)return [];
      return [{...m,type:a.source===account?'out':'in',lib:(m.lib||'Transfer')+' — '+treasuryAccountLabel(a.source)+' → '+treasuryAccountLabel(a.destination)}];
    }
    return a.account===account?[m]:[];
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function openAccountHistory(account){
  if(!['till','mobile','bank'].includes(account))return;
  let modal=g('m-account-history');
  if(!modal){modal=document.createElement('div');modal.id='m-account-history';modal.className='modal-overlay';modal.innerHTML='<div class="modal" style="max-width:850px"><div class="modal-hdr"><div class="modal-title" id="account-history-title"></div><button class="modal-close" onclick="closeM(\'m-account-history\')">×</button></div><div id="account-history-content"></div></div>';document.body.appendChild(modal);}
  sg('account-history-title','History — '+treasuryAccountLabel(account));
  const rows=accountTransactions(account).map(m=>[esc(fmtDate(m.date)),esc(m.lib),`<span style="color:${m.type==='in'?'#16a34a':'#ef4444'}">${m.type==='in'?'In':'Out'}</span>`,money(m.montant),esc(m.mode||'—')]);
  g('account-history-content').innerHTML=`<p>Current balance: <strong class="${treasuryBalances()[account]<0?'amount-neg':''}">${money(treasuryBalances()[account])}</strong></p><div style="max-height:60vh;overflow:auto">${rows.length?buildExportTable(['Date','Description','Type','Amount','Method'],rows):'<p>No transactions on this account.</p>'}</div>`;
  openM('m-account-history');
}
function downloadTreasuryExcel(){
  const xmlEscape=value=>String(value??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
  const cell=(value,style='',number=false)=>`<Cell${style?' ss:StyleID="'+style+'"':''}><Data ss:Type="${number?'Number':'String'}">${xmlEscape(value)}</Data></Cell>`;
  const rows=db.mouvements.map(m=>{const a=treasuryMovementAccounts(m);return '<Row>'+cell(m.date)+cell(m.lib)+cell(m.type==='in'?'In':m.type==='out'?'Out':'Transfer',m.type)+cell(Number(toInput(m.montant))||0,'',true)+cell(m.type==='transfer'?treasuryAccountLabel(a.source)+' → '+treasuryAccountLabel(a.destination):treasuryAccountLabel(a.account))+cell(m.mode)+'</Row>';}).join('');
  const xml='<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="in"><Font ss:Color="#16A34A" ss:Bold="1"/></Style><Style ss:ID="out"><Font ss:Color="#EF4444" ss:Bold="1"/></Style><Style ss:ID="transfer"><Font ss:Color="#2563EB"/></Style></Styles><Worksheet ss:Name="Treasury"><Table><Row>'+['Date','Description','Type','Amount','Account','Method'].map(v=>cell(v+(v==='Amount'?' ('+curSym()+')':''))).join('')+'</Row>'+rows+'</Table></Worksheet></Workbook>';
  const url=URL.createObjectURL(new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='kinta-treasury-'+today()+'.xml';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

window.renderTreasury=function(){
  const month=today().slice(0,7),monthly=db.mouvements.filter(m=>String(m.date||'').startsWith(month));
  const enc=monthly.filter(m=>m.type==='in').reduce((a,m)=>a+Number(m.montant||0),0),dec=monthly.filter(m=>m.type==='out').reduce((a,m)=>a+Number(m.montant||0),0),balances=treasuryBalances(),sol=balances.till+balances.mobile+balances.bank;
  // A negative balance is always shown in red; the summary's "Current balance" stays green only when it is positive or zero.
  const setBalance=(id,value,greenIfPositive=false)=>{sg(id,money(value));const el=g(id);if(el){el.classList.toggle('amount-neg',value<0);el.classList.toggle('amount-pos',greenIfPositive&&value>=0);}};
  setBalance('tr-solde',sol);setBalance('tr-dispo',sol);setBalance('tr-solde2',sol,true);
  ['tr-enc','tr-enc2','tr-total-enc'].forEach(id=>sg(id,money(enc)));['tr-dec','tr-dec2','tr-total-dec'].forEach(id=>sg(id,money(dec)));
  sg('tr-creances',money(db.clients.reduce((total,c)=>total+Number(c.solde||0),0)));
  setBalance('cpt-caisse',balances.till);setBalance('cpt-mobile',balances.mobile);setBalance('cpt-banque',balances.bank);
  const cashWarning=g('cpt-caisse-warning');if(cashWarning)cashWarning.hidden=balances.till>=0;
  setBalance('tr-opening',sol-enc+dec);sg('tr-month-title','Monthly summary ('+appNow().toLocaleDateString(LOCALE,{month:'long',year:'numeric'})+')');sg('tr-updated','Updated at '+appNow().toLocaleTimeString(LOCALE,{hour:'2-digit',minute:'2-digit'}));
  const tb=g('t-treso');if(tb)tb.innerHTML=db.mouvements.map((m,i)=>{const a=treasuryMovementAccounts(m),account=m.type==='transfer'?treasuryAccountLabel(a.source)+' → '+treasuryAccountLabel(a.destination):treasuryAccountLabel(a.account);return `<tr><td class="mono">${esc(fmtDate(m.date))}</td><td class="bold">${esc(m.lib)}</td><td><span class="badge ${m.type==='in'?'b-green':m.type==='out'?'b-red':'b-blue'}">${m.type==='in'?'In':m.type==='out'?'Out':'Transfer'}</span></td><td>${account}</td><td>${m.type==='transfer'?'Internal account':'Transaction'}</td><td class="mono" style="font-weight:600;color:${m.type==='in'?'#16a34a':m.type==='out'?'#ef4444':'#3b82f6'}">${m.type==='in'?'+':m.type==='out'?'-':'↔ '}${money(m.montant)}</td><td>${esc(m.mode||'Cash')}</td><td><div style="display:flex;gap:5px"><button class="btn btn-outline btn-xs" onclick="openTreasuryOperation('${m.type}',${i})">Edit</button><button class="btn btn-danger btn-xs" onclick="deleteMovement(${i})">×</button></div></td></tr>`;}).join('')||emptyR(8,'No transactions');
  setTimeout(()=>renderTreasuryDonut(),60);
};

function periodBounds(p){
  const now=appNow(),start=new Date(now),end=new Date(now);start.setHours(0,0,0,0);end.setHours(23,59,59,999);
  if(p==='hier'){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1);} else if(p==='7j')start.setDate(start.getDate()-6);else if(p==='30j')start.setDate(start.getDate()-29);else if(p==='mois')start.setDate(1);else if(p==='mois-d'){start.setMonth(start.getMonth()-1,1);end.setDate(0);} else if(p==='custom'){start.setTime(new Date(gv('rp-du')+'T00:00:00').getTime());end.setTime(new Date(gv('rp-au')+'T23:59:59').getTime());}
  return [start,end];
}
window.setPeriod=function(p,btn){
  document.querySelectorAll('#page-rapports .period-tabs .ptab').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');
  if(p==='custom'){ensureV62Modals();g('rp-du').value=today();g('rp-au').value=today();openM('m-rapport-periode');return;}_reportPeriod=p;renderReports();
};
function applyCustomPeriod(){if(!gv('rp-du')||!gv('rp-au')||gv('rp-du')>gv('rp-au')){toast('Invalid period','red');return;}_reportPeriod='custom';closeM('m-rapport-periode');renderReports();}
function reportMetrics(from,to){
  return salesMetrics(db.factures.filter(f=>{const d=new Date(f.date+'T12:00:00');return d>=from&&d<=to&&f.statut!=='Cancelled';}));
}
function salesMetrics(factures){
  const paid=factures.filter(f=>f.statut==='Paid');
  const total=factures.reduce((sum,f)=>sum+Number(f.montant||0),0),enc=paid.reduce((sum,f)=>sum+Number(f.montant||0),0);let cout=0;
  factures.forEach(f=>(f.lignes||[]).forEach(l=>{const p=db.produits.find(x=>x.id===l.productId||x.nom===(l.d||l.desc));cout+=Number(p?.pa||0)*Number(l.q||l.qte||0);}));
  return {factures,total,enc,benef:Math.max(0,total-cout),count:factures.length,panier:factures.length?Math.round(total/factures.length):0};
}
function previousReportBounds(from,to){const duration=to.getTime()-from.getTime()+1,previousTo=new Date(from.getTime()-1),previousFrom=new Date(previousTo.getTime()-duration+1);return [previousFrom,previousTo];}
function reportPeriodLabel(from,to){return from.toLocaleDateString(LOCALE)+' – '+to.toLocaleDateString(LOCALE);}
function setReportDifference(id,value,suffix=null){const el=g(id);if(!el)return;el.textContent=(value>0?'+':'')+(suffix===null?money(value):fmt(value)+suffix);el.style.color=value>0?'#16a34a':value<0?'#ef4444':'#64748b';}
function showOlderReportMonths(){ensureV62Modals();const end=appNow(),start=new Date(end);start.setMonth(start.getMonth()-11,1);g('rp-du').value=start.toISOString().slice(0,10);g('rp-au').value=end.toISOString().slice(0,10);_reportPeriod='custom';document.querySelectorAll('#page-rapports .period-tabs .ptab').forEach(b=>b.classList.remove('on'));renderReports();}
window.renderReports=function(){
  const [du,au]=periodBounds(_reportPeriod),[prevDu,prevAu]=previousReportBounds(du,au),current=reportMetrics(du,au),previous=reportMetrics(prevDu,prevAu);
  sg('rp-total',money(current.total));sg('rp-enc',money(current.enc));sg('rp-benef',money(current.benef));sg('rp-count',String(current.count));sg('rp-panier',money(current.panier));
  sg('rp-compare-title',reportPeriodLabel(du,au)+' vs '+reportPeriodLabel(prevDu,prevAu));
  const noComparison=current.count===0&&previous.count===0;if(g('rp-compare-empty'))g('rp-compare-empty').style.display=noComparison?'block':'none';if(g('rp-compare-stats'))g('rp-compare-stats').style.display=noComparison?'none':'block';
  if(!noComparison){setReportDifference('rp-diff-total',current.total-previous.total);setReportDifference('rp-diff-enc',current.enc-previous.enc);setReportDifference('rp-diff-benef',current.benef-previous.benef);setReportDifference('rp-diff-count',current.count-previous.count,'');setReportDifference('rp-diff-panier',current.panier-previous.panier);}
  const row=(label,m,status)=>`<tr><td class="bold">${label}</td><td class="mono">${amt(m.total)}</td><td class="mono">${amt(m.enc)}</td><td class="mono green">${amt(m.benef)}</td><td>${m.count}</td><td class="mono">${fmt(m.panier)}</td><td><span class="badge ${status==='Selected'?'b-green':'b-gray'}">${status}</span></td></tr>`;
  const tb=g('t-rapport-detail');if(tb)tb.innerHTML=noComparison?emptyR(7,'No sales recorded for these periods'):row(reportPeriodLabel(du,au),current,'Selected')+row(reportPeriodLabel(prevDu,prevAu),previous,'Comparison');
  if(rapportChart){rapportChart.destroy();rapportChart=null;}const cv=g('rapport-chart'),chartEmpty=g('rp-chart-empty');if(cv)cv.style.display=noComparison?'none':'block';if(chartEmpty)chartEmpty.style.display=noComparison?'flex':'none';if(cv&&!noComparison)rapportChart=new Chart(cv.getContext('2d'),{type:'bar',data:{labels:['Total sales','Receipts','Gross profit'],datasets:[{label:'Selected period',data:[current.total,current.enc,current.benef],backgroundColor:'#16a34a',borderRadius:4},{label:'Previous period',data:[previous.total,previous.enc,previous.benef],backgroundColor:'#cbd5e1',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true}},scales:{y:{beginAtZero:true,ticks:{callback:v=>amt(v)}}}}});
};

window.renderEmployees=function(){
  const tot=db.employes.reduce((a,e)=>a+e.salaire,0),avg=db.employes.length?Math.round(db.employes.reduce((a,e)=>a+e.pres,0)/db.employes.length):0;sg('e-cnt',String(db.employes.length));sg('e-sal',amt(tot));sg('e-pres',avg+'%');
  const rows=db.employes.map((e,i)=>`<tr><td class="mono bold">${esc(e.id||'E'+String(i+1).padStart(4,'0'))}</td><td class="bold">${esc(e.prenom+' '+e.nom)}</td><td class="mono">${esc(e.tel||'—')}</td><td>${esc(e.poste||'—')}</td><td class="mono">${esc(fmtDate(e.date))}</td><td class="mono">${money(e.salaire)}</td><td class="mono">${money(Math.round(e.salaire*EMPLOYER_LEVY_RATE))}</td><td>${e.pres}%</td><td><span class="badge b-green">Active</span></td><td><div style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-outline btn-xs" onclick="generatePayslip(${i})">Payslip</button><button class="btn btn-outline btn-xs" onclick="openEmployeeModal(${i})">Edit</button><button class="btn btn-danger btn-xs" onclick="deleteEmployee(${i})">Delete</button></div></td></tr>`);
  renderPaginatedTable('t-emp',rows,'No employees',10);
};

function renderBalanceSheetV62(){
  renderAccounting();const ids=['bilan-tresorerie','bilan-stock','bilan-creances','bilan-assets-total','bilan-resultat','bilan-dettes','bilan-tva-p','bilan-liabilities-total'];
  ids.forEach(id=>{const els=document.querySelectorAll('#'+id);if(els.length>1)for(let i=1;i<els.length;i++)els[i].textContent=els[0].textContent;});
}
const _switchAccountingV62=switchAccountingTab;window.switchAccountingTab=function(tab){_switchAccountingV62(tab);if(tab==='bilan')renderBalanceSheetV62();};
document.addEventListener('DOMContentLoaded',()=>{
  ensureV62Modals();
  document.querySelectorAll('#page-tresorerie [onclick="openM(\'m-mouv\')"]').forEach((el,i)=>el.setAttribute('onclick',i===1?"openTreasuryOperation('transfer')":"openTreasuryOperation('in')"));
});
