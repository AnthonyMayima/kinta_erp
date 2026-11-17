'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { run, get, all, transaction } = require('../../database/schema');
const { translateState } = require('../../database/english-migration');
const { authMiddleware, adminOnly, notSalesperson, accountingOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const appNow = req => {
  if(process.env.ALLOW_TEST_CLOCK !== 'true' || !req?.user?.boutiqueId)return new Date();
  const offset=Number(get('SELECT test_clock_offset_ms FROM boutiques WHERE id=?',[req.user.boutiqueId])?.test_clock_offset_ms);
  return new Date(Date.now()+(Number.isFinite(offset)?offset:0));
};
const today = req => appNow(req).toISOString().split('T')[0];
const canOperateCashRegister = (req, res, next) => {
  if (!['admin','cashier'].includes(req.user.role)) return res.status(403).json({ error: 'Till staff only' });
  next();
};
const cleanMessageText = value => String(value||'').trim().slice(0,2000);
const cleanText = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const finiteNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function readAppState(boutiqueId) {
  const row=get('SELECT data FROM app_state WHERE boutique_id=?',[boutiqueId]);
  if(!row)return null;
  try{return JSON.parse(row.data);}catch(_){return null;}
}

function findTicketSale(boutiqueId, rawNumero) {
  const numero=String(rawNumero||'').trim().toUpperCase();
  if(!numero)return null;
  const stored=get('SELECT id,numero,montant,remise,client_nom,lignes FROM caisse_ventes WHERE boutique_id=? AND UPPER(numero)=?',[boutiqueId,numero]);
  if(stored)return stored;
  const state=readAppState(boutiqueId),invoice=(state?.factures||[]).find(f=>String(f.num||'').trim().toUpperCase()===numero);
  if(!invoice)return null;
  return {id:invoice.id||numero,numero:invoice.num,montant:Number(invoice.montant)||0,remise:Number(invoice.remise)||0,client_nom:invoice.client||'Walk-in customer',lignes:JSON.stringify(invoice.lignes||[])};
}

router.get('/caisse/session', canOperateCashRegister, (req,res)=>{
  const session=get("SELECT * FROM caisse_sessions WHERE boutique_id=? AND utilisateur_id=? AND statut='open' ORDER BY ouverte_le DESC LIMIT 1",[req.user.boutiqueId,req.user.id]);
  res.json({session});
});
router.get('/caisse/sessions', adminOnly, (req,res)=>{
  const limit=Math.min(200,Math.max(1,Number(req.query.limit)||50));
  const sessions=all(`SELECT id,utilisateur_id,utilisateur_nom,ouverte_le,fonds_initial,statut,fermee_le,
    especes_theoriques,especes_comptees,ecart,total_ventes,ventes_especes,ventes_mobile,nombre_ventes,rapport_z
    FROM caisse_sessions WHERE boutique_id=? ORDER BY CASE WHEN statut='open' THEN 0 ELSE 1 END, ouverte_le DESC LIMIT ?`,[req.user.boutiqueId,limit]);
  res.json({sessions});
});
router.get('/assistance-demandes',adminOnly,(req,res)=>{
  res.json({demandes:all(`SELECT d.id,d.motif,d.statut,d.demande_le,d.expire_le,k.nom agent
    FROM demandes_assistance d JOIN kinta_admins k ON k.id=d.admin_kinta_id
    WHERE d.boutique_id=? ORDER BY d.demande_le DESC LIMIT 50`,[req.user.boutiqueId])});
});
router.patch('/assistance-demandes/:id',adminOnly,(req,res)=>{
  if(!['approved','refused'].includes(req.body.statut))return res.status(400).json({error:'Invalid decision'});
  const d=get("SELECT id FROM demandes_assistance WHERE id=? AND boutique_id=? AND statut='pending'",[req.params.id,req.user.boutiqueId]);
  if(!d)return res.status(404).json({error:'Request not found or already handled'});
  const expiry=new Date(Date.now()+30*60*1000).toISOString();
  run('UPDATE demandes_assistance SET statut=?,approuve_par=?,approuve_le=datetime(\'now\'),expire_le=? WHERE id=?',[req.body.statut,req.user.id,req.body.statut==='approved'?expiry:null,d.id]);
  run('INSERT INTO audit_log (id,boutique_id,user_id,action,details) VALUES (?,?,?,?,?)',[uuidv4(),req.user.boutiqueId,req.user.id,'SUPPORT_'+req.body.statut.toUpperCase(),JSON.stringify({demande:d.id,expire_le:req.body.statut==='approved'?expiry:null})]);
  res.json({success:true,expire_le:req.body.statut==='approved'?expiry:null});
});
router.post('/caisse/ouvrir', canOperateCashRegister, (req,res)=>{
  const existing=get("SELECT id FROM caisse_sessions WHERE boutique_id=? AND utilisateur_id=? AND statut='open'",[req.user.boutiqueId,req.user.id]);
  if(existing)return res.status(409).json({error:'A till session is already open'});
  const fonds=Math.max(0,Number(req.body.fonds_initial)||0),id=uuidv4();
  run('INSERT INTO caisse_sessions (id,boutique_id,utilisateur_id,utilisateur_nom,fonds_initial,ouverte_le) VALUES (?,?,?,?,?,?)',[id,req.user.boutiqueId,req.user.id,req.user.nom||req.user.login,fonds,appNow(req).toISOString()]);
  res.json({success:true,session:get('SELECT * FROM caisse_sessions WHERE id=?',[id])});
});
router.post('/caisse/ventes', canOperateCashRegister, (req,res)=>{
  const session=get("SELECT * FROM caisse_sessions WHERE boutique_id=? AND utilisateur_id=? AND statut='open'",[req.user.boutiqueId,req.user.id]);
  if(!session)return res.status(409).json({error:'Open the till before taking payments'});
  const state=readAppState(req.user.boutiqueId);
  if(!state)return res.status(409).json({error:'Shop data not initialised'});
  const lignes=Array.isArray(req.body.lignes)?req.body.lignes:[];
  const rawRemise=finiteNumber(req.body.remise ?? 0),mode=req.body.mode||'Cash';
  if(!['Cash','E-wallet','Credit'].includes(mode))return res.status(400).json({error:'Invalid payment method'});
  const client=(state.clients||[]).find(c=>c.id===req.body.client_id);
  if(mode==='Credit'&&!client)return res.status(400).json({error:'Select a customer for the credit sale'});
  if(rawRemise===null||rawRemise<0)return res.status(400).json({error:'Invalid discount'});
  const remise=rawRemise;
  if(!lignes.length)return res.status(400).json({error:'Cart empty'});
  let brut=0;
  for(const line of lignes){
    const product=(state.produits||[]).find(p=>p.id===line.produit_id),qty=finiteNumber(line.quantite);
    if(!product||qty===null||qty<=0||!Number.isInteger(qty)) return res.status(400).json({error:'Invalid product or quantity'});
    if(Number(product.stk)<qty)return res.status(409).json({error:'Insufficient stock for '+product.nom});
    const price=finiteNumber(product.pv);
    if(price===null||price<0)return res.status(409).json({error:'Invalid price for '+product.nom});
    brut+=price*qty;
  }
  if(remise>brut)return res.status(400).json({error:'The discount cannot exceed the total'});
  const montant=brut-remise,year=appNow(req).getUTCFullYear();
  if(mode==='Credit'&&Number(client.credit)>0&&Number(client.solde||0)+montant>Number(client.credit))return res.status(409).json({error:'Customer credit limit exceeded'});
  const previous=all('SELECT numero FROM caisse_ventes WHERE boutique_id=? AND numero LIKE ?',[req.user.boutiqueId,`TK-${year}-%`])
    .reduce((max,row)=>Math.max(max,Number(String(row.numero).split('-').pop())||0),0);
  const numero='TK-'+year+'-'+String(previous+1).padStart(5,'0'),id=uuidv4(),date=today(req);
  transaction(()=>{
    const ticketLines=lignes.map(line=>{const p=state.produits.find(x=>x.id===line.produit_id);p.stk=Number(p.stk)-Number(line.quantite);return {d:p.nom,q:Number(line.quantite),pu:Number(p.pv),t:Number(p.pv)*Number(line.quantite),productId:p.id};});
    state.factures=state.factures||[];state.mouvements=state.mouvements||[];
    const clientNom=client?.nom||cleanText(req.body.client_nom,120)||'Walk-in customer';
    state.factures.unshift({id,num:numero,client:clientNom,clientId:client?.id,date,ech:date,montant,remise,statut:mode==='Credit'?'On credit':'Paid',resteDu:mode==='Credit'?montant:0,mode,lignes:ticketLines,caissier:req.user.nom||req.user.login,caissierId:req.user.id,sessionId:session.id});
    if(mode==='Credit')client.solde=Number(client.solde||0)+montant;
    else state.mouvements.unshift({id:'MV'+uuidv4().slice(0,8),date,lib:'Till sale '+numero,type:'in',montant,mode,sessionId:session.id});
    run('UPDATE app_state SET data=?,updated_at=datetime(\'now\'),version=version+1 WHERE boutique_id=?',[JSON.stringify(state),req.user.boutiqueId]);
    run('INSERT INTO caisse_ventes (id,boutique_id,session_id,numero,montant,mode,remise,client_nom,lignes) VALUES (?,?,?,?,?,?,?,?,?)',[id,req.user.boutiqueId,session.id,numero,montant,mode,remise,clientNom,JSON.stringify(ticketLines)]);
    run(`UPDATE caisse_sessions SET total_ventes=total_ventes+?,nombre_ventes=nombre_ventes+1,
      ventes_especes=ventes_especes+?,ventes_mobile=ventes_mobile+? WHERE id=?`,[montant,mode==='Cash'?montant:0,mode==='E-wallet'?montant:0,session.id]);
  });
  const version=Number(get('SELECT version FROM app_state WHERE boutique_id=?',[req.user.boutiqueId])?.version)||0;
  res.json({success:true,ticket:state.factures[0],session:get('SELECT * FROM caisse_sessions WHERE id=?',[session.id]),state,version});
});
router.post('/caisse/cloturer', canOperateCashRegister, (req,res)=>{
  const session=req.body.session_id
    ?get("SELECT * FROM caisse_sessions WHERE boutique_id=? AND id=? AND statut='open'",[req.user.boutiqueId,req.body.session_id])
    :get("SELECT * FROM caisse_sessions WHERE boutique_id=? AND utilisateur_id=? AND statut='open'",[req.user.boutiqueId,req.user.id]);
  if(!session)return res.status(409).json({error:'No open till session'});
  if(req.user.role!=='admin'&&session.utilisateur_id!==req.user.id)return res.status(403).json({error:'Only the manager can close another person\'s till'});
  const compte=Number(req.body.especes_comptees);if(!Number.isFinite(compte)||compte<0)return res.status(400).json({error:'Invalid counted amount'});
  const theorique=Number(session.fonds_initial)+Number(session.ventes_especes),ecart=compte-theorique;
  const closedAt=appNow(req).toISOString();
  const report={numero:'Z-'+closedAt.replace(/\D/g,'').slice(0,14),session_id:session.id,caissier:session.utilisateur_nom,ouverte_le:session.ouverte_le,fermee_le:closedAt,fonds_initial:Number(session.fonds_initial),nombre_ventes:Number(session.nombre_ventes),total_ventes:Number(session.total_ventes),ventes_especes:Number(session.ventes_especes),ventes_mobile:Number(session.ventes_mobile),especes_theoriques:theorique,especes_comptees:compte,ecart};
  run("UPDATE caisse_sessions SET statut='closed',fermee_le=?,especes_theoriques=?,especes_comptees=?,ecart=?,rapport_z=? WHERE id=?",[closedAt,theorique,compte,ecart,JSON.stringify(report),session.id]);
  run('INSERT INTO audit_log (id,boutique_id,user_id,action,details) VALUES (?,?,?,?,?)',[uuidv4(),req.user.boutiqueId,req.user.id,'TILL_CLOSED',JSON.stringify({session_id:session.id,caissier:session.utilisateur_nom,ecart})]);
  res.json({success:true,rapport_z:report});
});

// Centralised application state. It stays compatible with the legacy
// interface while sharing the data between devices.
router.get('/state', (req, res) => {
  const row = get('SELECT data, updated_at, version FROM app_state WHERE boutique_id = ?', [req.user.boutiqueId]);
  if (!row) return res.json({ state: null, updated_at: null, version: 0 });
  try {
    const stored = JSON.parse(row.data);
    if (req.user.role === 'admin') return res.json({ state: stored, updated_at: row.updated_at, version: Number(row.version)||0 });
    const settings = stored.settings || {};
    const publicSettings = ['nom','slogan','adresse','ville','tel','email','devise','tva','logo','mentions']
      .reduce((result, key) => { if (settings[key] !== undefined) result[key] = settings[key]; return result; }, {});
    const products = (stored.produits || []).map(({ id,nom,ref,bc,cat,scat,stk,min,pv,lot,exp }) => ({ id,nom,ref,bc,cat,scat,stk,min,pv,lot,exp }));
    const clients = (stored.clients || []).map(({ id,nom,tel,ville,solde,type,credit }) => ({ id,nom,tel,ville,solde,type,credit }));
    if (req.user.role === 'accountant') {
      return res.json({ state: {
        settings:publicSettings,
        factures:stored.factures||[], mouvements:stored.mouvements||[], depenses:stored.depenses||[],
        journal:stored.journal||[], reglements_clients:stored.reglements_clients||[]
      }, updated_at:row.updated_at, version:Number(row.version)||0 });
    }
    const shared = { settings:publicSettings, produits:products, clients, factures:stored.factures||[], pos_day:stored.pos_day||{} };
    if (req.user.role === 'cashier') {
      shared.mouvements = stored.mouvements || [];
      shared.admin_notifications = stored.admin_notifications || [];
      shared.reglements_clients = stored.reglements_clients || [];
    }
    if (req.user.role === 'salesperson') shared.mouvements = stored.mouvements || [];
    res.json({ state: shared, updated_at: row.updated_at, version:Number(row.version)||0 });
  }
  catch (_) { res.status(500).json({ error: 'Server backup unreadable' }); }
});

router.put('/state', notSalesperson, (req, res) => {
  let state = req.body && req.body.state;
  if (!state || typeof state !== 'object' || Array.isArray(state))
    return res.status(400).json({ error: 'Invalid application state' });
  // A browser still holding pre-English data must not write French values back.
  state = translateState(state, '');
  const currentVersion=Number(get('SELECT version FROM app_state WHERE boutique_id=?',[req.user.boutiqueId])?.version)||0;
  const baseVersion=finiteNumber(req.body.base_version);
  if(baseVersion!==null&&baseVersion!==currentVersion)
    return res.status(409).json({error:'This data was changed on another device. Refresh before trying again.',code:'STATE_CONFLICT',version:currentVersion});
  if (req.user.role !== 'admin') {
    const currentRow = get('SELECT data FROM app_state WHERE boutique_id = ?', [req.user.boutiqueId]);
    let current = {};
    try { current = currentRow ? JSON.parse(currentRow.data) : {}; } catch (_) {}
    const operationalKeys = req.user.role === 'accountant'
      ? ['journal']
      : ['factures','mouvements','pos_day','admin_notifications','reglements_clients'];
    state = { ...current };
    for (const key of operationalKeys) {
      if (Object.prototype.hasOwnProperty.call(req.body.state, key)) state[key] = req.body.state[key];
    }
    // The cashier can change stock and customer balances as sales are made,
    // but cannot edit the catalogue, prices or identities.
    if (Array.isArray(current.produits) && Array.isArray(req.body.state.produits)) {
      const incoming = new Map(req.body.state.produits.map(item => [item.id, item]));
      state.produits = current.produits.map(item => ({ ...item, stk: Number(incoming.get(item.id)?.stk ?? item.stk) }));
    }
    if (Array.isArray(current.clients) && Array.isArray(req.body.state.clients)) {
      const incoming = new Map(req.body.state.clients.map(item => [item.id, item]));
      state.clients = current.clients.map(item => ({ ...item, solde: Number(incoming.get(item.id)?.solde ?? item.solde) }));
    }
  }
  const payload = JSON.stringify(state);
  if (Buffer.byteLength(payload, 'utf8') > 8 * 1024 * 1024)
    return res.status(413).json({ error: 'Backup too large' });
  const nextVersion=currentVersion+1;
  transaction(()=>{
    run(`INSERT INTO app_state (boutique_id,data,updated_at,version) VALUES (?,?,datetime('now'),?)
         ON CONFLICT(boutique_id) DO UPDATE SET data=excluded.data,updated_at=datetime('now'),version=excluded.version`,
        [req.user.boutiqueId, payload, nextVersion]);
    run('INSERT INTO audit_log (id,boutique_id,user_id,action,details) VALUES (?,?,?,?,?)',
        [uuidv4(), req.user.boutiqueId, req.user.id, 'STATE_SAVE', JSON.stringify({ bytes: Buffer.byteLength(payload), version:nextVersion })]);
  });
  res.json({ success: true, version:nextVersion });
});

// ══ SETTINGS ══
router.get('/settings', adminOnly, (req, res) => {
  const boutique = get('SELECT * FROM boutiques WHERE id = ?', [req.user.boutiqueId]);
  const users = all('SELECT id, login, role, nom, actif FROM utilisateurs WHERE boutique_id = ? AND actif = 1', [req.user.boutiqueId]);
  res.json({ boutique, users });
});
router.put('/settings', adminOnly, (req, res) => {
  const { nom, slogan, adresse, ville, tel, email, web, rccm, niu, tva, devise, couleur, logo, mentions } = req.body;
  run('UPDATE boutiques SET nom=?,slogan=?,adresse=?,ville=?,tel=?,email=?,web=?,rccm=?,niu=?,tva=?,devise=?,couleur=?,logo=?,mentions=? WHERE id=?',
      [nom,slogan||'',adresse||'',ville||'',tel||'',email||'',web||'',rccm||'',niu||'',tva||15,devise||'ZAR',couleur||'#16a34a',logo||'',mentions||'',req.user.boutiqueId]);
  res.json({ success: true });
});

// Simulated clock, reserved for instances explicitly dedicated to testing.
router.get('/test-clock', (req,res)=>{
  const enabled=process.env.ALLOW_TEST_CLOCK==='true';
  const offset=enabled?Number(get('SELECT test_clock_offset_ms FROM boutiques WHERE id=?',[req.user.boutiqueId])?.test_clock_offset_ms):NaN;
  res.json({enabled,active:enabled&&Number.isFinite(offset),now:appNow(req).toISOString()});
});
router.put('/test-clock', adminOnly, (req,res)=>{
  if(process.env.ALLOW_TEST_CLOCK!=='true')return res.status(403).json({error:'Test clock disabled on this server'});
  if(req.body.reset===true){
    run('UPDATE boutiques SET test_clock_offset_ms=NULL WHERE id=?',[req.user.boutiqueId]);
    return res.json({success:true,active:false,now:new Date().toISOString()});
  }
  const target=new Date(req.body.datetime);
  if(!req.body.datetime||!Number.isFinite(target.getTime()))return res.status(400).json({error:'Invalid date and time'});
  const offset=target.getTime()-Date.now();
  run('UPDATE boutiques SET test_clock_offset_ms=? WHERE id=?',[offset,req.user.boutiqueId]);
  res.json({success:true,active:true,now:appNow(req).toISOString()});
});

// ══ USERS ══
router.get('/users', adminOnly, (req, res) => {
  res.json({ users: all('SELECT id, login, role, nom, actif, created_at FROM utilisateurs WHERE boutique_id = ? AND actif = 1 ORDER BY created_at', [req.user.boutiqueId]) });
});
router.post('/users', adminOnly, async (req, res) => {
  const { login, password, role, nom } = req.body;
  if (!login || !password || password.length < 8) return res.status(400).json({ error: 'Login and password (min 8) required' });
  if (!['admin','cashier','salesperson','accountant'].includes(role || 'salesperson')) return res.status(400).json({ error: 'Invalid user role' });
  const subscription=get('SELECT * FROM abonnements WHERE boutique_id=?',[req.user.boutiqueId]);
  const activeUsers=get('SELECT COUNT(*) n FROM utilisateurs WHERE boutique_id=? AND actif=1',[req.user.boutiqueId]);
  if(subscription&&Number(activeUsers?.n||0)>=Number(subscription.limite_utilisateurs))return res.status(403).json({error:`Limit of ${subscription.limite_utilisateurs} users reached for plan ${subscription.formule}`});
  try {
    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    run('INSERT INTO utilisateurs (id,boutique_id,login,password_hash,role,nom) VALUES (?,?,?,?,?,?)',
        [id,req.user.boutiqueId,login,hash,role||'salesperson',nom||login]);
    res.json({ success: true, id });
  } catch(e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: e.message });
  }
});
router.delete('/users/:id', adminOnly, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  run('UPDATE utilisateurs SET actif = 0 WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});

// ══ CLIENTS ══
router.get('/clients', (req, res) => {
  res.json({ clients: all('SELECT * FROM clients WHERE boutique_id = ? ORDER BY nom', [req.user.boutiqueId]) });
});
router.post('/clients', notSalesperson, (req, res) => {
  const { nom, tel, email, ville, adresse, type, credit } = req.body;
  if (!nom) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  run('INSERT INTO clients (id,boutique_id,nom,tel,email,ville,adresse,type,credit) VALUES (?,?,?,?,?,?,?,?,?)',
      [id,req.user.boutiqueId,nom,tel||'',email||'',ville||'Johannesburg',adresse||'',type||'Retailer',credit||0]);
  res.json({ success: true, id });
});
router.put('/clients/:id', notSalesperson, (req, res) => {
  const { nom, tel, email, ville, adresse, type, credit, solde } = req.body;
  run('UPDATE clients SET nom=?,tel=?,email=?,ville=?,adresse=?,type=?,credit=?,solde=? WHERE id=? AND boutique_id=?',
      [nom,tel||'',email||'',ville||'',adresse||'',type||'',credit||0,solde||0,req.params.id,req.user.boutiqueId]);
  res.json({ success: true });
});
router.delete('/clients/:id', adminOnly, (req, res) => {
  run('DELETE FROM clients WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});
router.get('/clients/:id/historique', (req, res) => {
  const cli = get('SELECT * FROM clients WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  const ventes = all('SELECT * FROM ventes WHERE client_id = ? AND boutique_id = ? ORDER BY date DESC', [req.params.id, req.user.boutiqueId]);
  res.json({ client: cli, ventes });
});

// ══ PRODUCTS ══
router.get('/produits', (req, res) => {
  res.json({ produits: all('SELECT * FROM produits WHERE boutique_id = ? AND actif = 1 ORDER BY nom', [req.user.boutiqueId]) });
});
router.post('/produits', notSalesperson, (req, res) => {
  const { nom, ref, barcode, categorie, sous_categorie, stock, stock_min, prix_achat, prix_vente, lot, date_expiry } = req.body;
  if (!nom) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  run('INSERT INTO produits (id,boutique_id,nom,ref,barcode,categorie,sous_categorie,stock,stock_min,prix_achat,prix_vente,lot,date_expiry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id,req.user.boutiqueId,nom,ref||'',barcode||'',categorie||'Food',sous_categorie||'',stock||0,stock_min||10,prix_achat||0,prix_vente||0,lot||'',date_expiry||'']);
  if ((stock||0) > 0)
    run('INSERT INTO stock_mouvements (id,boutique_id,produit_id,date,type,quantite,reference) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(),req.user.boutiqueId,id,today(req),'entree',stock,'Stock initial']);
  res.json({ success: true, id });
});
router.put('/produits/:id', notSalesperson, (req, res) => {
  const { nom, ref, barcode, categorie, sous_categorie, stock, stock_min, prix_achat, prix_vente, lot, date_expiry } = req.body;
  const ancien = get('SELECT stock FROM produits WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  run('UPDATE produits SET nom=?,ref=?,barcode=?,categorie=?,sous_categorie=?,stock=?,stock_min=?,prix_achat=?,prix_vente=?,lot=?,date_expiry=? WHERE id=? AND boutique_id=?',
      [nom,ref||'',barcode||'',categorie||'',sous_categorie||'',stock||0,stock_min||10,prix_achat||0,prix_vente||0,lot||'',date_expiry||'',req.params.id,req.user.boutiqueId]);
  if (ancien && ancien.stock !== (stock||0)) {
    const diff = (stock||0) - (ancien.stock||0);
    run('INSERT INTO stock_mouvements (id,boutique_id,produit_id,date,type,quantite,reference) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(),req.user.boutiqueId,req.params.id,today(req),diff>0?'entree':'sortie',Math.abs(diff),'Ajustement']);
  }
  res.json({ success: true });
});
router.delete('/produits/:id', adminOnly, (req, res) => {
  run('UPDATE produits SET actif = 0 WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});
router.get('/produits/:id/mouvements', (req, res) => {
  res.json({ mouvements: all('SELECT * FROM stock_mouvements WHERE produit_id = ? AND boutique_id = ? ORDER BY date DESC LIMIT 100', [req.params.id, req.user.boutiqueId]) });
});
router.post('/produits/import', notSalesperson, (req, res) => {
  const { produits } = req.body;
  if (!Array.isArray(produits)) return res.status(400).json({ error: 'Product list required' });
  let added = 0, updated = 0;
  transaction(() => {
    for (const p of produits) {
      const existing = get('SELECT id FROM produits WHERE (ref=? OR nom=?) AND boutique_id=? AND actif=1', [p.ref||'',p.nom,req.user.boutiqueId]);
      if (existing) {
        run('UPDATE produits SET nom=?,stock=?,stock_min=?,prix_achat=?,prix_vente=? WHERE id=? AND boutique_id=?',
            [p.nom,p.stock||0,p.stock_min||10,p.prix_achat||0,p.prix_vente||0,existing.id,req.user.boutiqueId]);
        updated++;
      } else {
        run('INSERT INTO produits (id,boutique_id,nom,ref,barcode,categorie,sous_categorie,stock,stock_min,prix_achat,prix_vente) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            [uuidv4(),req.user.boutiqueId,p.nom,p.ref||'',p.barcode||'',p.categorie||'Food',p.sous_categorie||'',p.stock||0,p.stock_min||10,p.prix_achat||0,p.prix_vente||0]);
        added++;
      }
    }
  });
  res.json({ success: true, added, updated, message: added + ' added, ' + updated + ' updated' });
});

// ══ SUPPLIERS ══
router.get('/fournisseurs', (req, res) => {
  res.json({ fournisseurs: all('SELECT * FROM fournisseurs WHERE boutique_id = ? ORDER BY nom', [req.user.boutiqueId]) });
});
router.post('/fournisseurs', notSalesperson, (req, res) => {
  const { nom, tel, email, categorie, adresse } = req.body;
  if (!nom) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  run('INSERT INTO fournisseurs (id,boutique_id,nom,tel,email,categorie,adresse) VALUES (?,?,?,?,?,?,?)',
      [id,req.user.boutiqueId,nom,tel||'',email||'',categorie||'',adresse||'']);
  res.json({ success: true, id });
});
router.delete('/fournisseurs/:id', adminOnly, (req, res) => {
  run('DELETE FROM fournisseurs WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});

// ══ SALES ══
router.get('/ventes', (req, res) => {
  const { statut, from, to } = req.query;
  let sql = 'SELECT * FROM ventes WHERE boutique_id = ?';
  const params = [req.user.boutiqueId];
  if (statut) { sql += ' AND statut = ?'; params.push(statut); }
  if (from)   { sql += ' AND date >= ?'; params.push(from); }
  if (to)     { sql += ' AND date <= ?'; params.push(to); }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  const ventes = all(sql, params);
  ventes.forEach(v => {
    v.lignes = all('SELECT * FROM vente_lignes WHERE vente_id = ?', [v.id])
               .map(l => ({ d: l.designation, q: l.quantite, pu: l.prix_unitaire, t: l.total }));
  });
  res.json({ ventes });
});
router.post('/ventes', notSalesperson, (req, res) => {
  const { client_id, client_nom, date, echeance, montant, remise, statut, mode_paiement, lignes, notes } = req.body;
  if (!montant) return res.status(400).json({ error: 'Amount required' });
  const countRow = get('SELECT COUNT(*) as n FROM ventes WHERE boutique_id = ?', [req.user.boutiqueId]);
  const num = 'TK-' + appNow(req).getUTCFullYear() + '-' + String(((countRow||{n:0}).n) + 1).padStart(5,'0');
  const id = uuidv4();
  try {
    transaction(() => {
      run('INSERT INTO ventes (id,boutique_id,num,client_id,client_nom,date,echeance,montant,remise,statut,mode_paiement,caissier_id,caissier_nom,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [id,req.user.boutiqueId,num,client_id||null,client_nom||'Walk-in customer',date||today(req),echeance||null,montant,remise||0,statut||'Pending',mode_paiement||'Cash',req.user.id,req.user.nom||req.user.login,notes||'']);
      if (Array.isArray(lignes)) {
        for (const l of lignes) {
          run('INSERT INTO vente_lignes (id,vente_id,produit_id,designation,quantite,prix_unitaire,total) VALUES (?,?,?,?,?,?,?)',
              [uuidv4(),id,l.produit_id||null,l.d||l.designation||'',l.q||l.quantite||1,l.pu||l.prix_unitaire||0,l.t||l.total||0]);
          if (l.produit_id) {
            run('UPDATE produits SET stock = MAX(0, stock - ?) WHERE id = ? AND boutique_id = ?', [l.q||1,l.produit_id,req.user.boutiqueId]);
            run('INSERT INTO stock_mouvements (id,boutique_id,produit_id,date,type,quantite,reference) VALUES (?,?,?,?,?,?,?)',
                [uuidv4(),req.user.boutiqueId,l.produit_id,date||today(req),'sortie',l.q||1,num]);
          }
        }
      }
      if ((statut||'') === 'Paid')
        run('INSERT INTO mouvements (id,boutique_id,date,libelle,type,montant,mode,categorie,reference_id) VALUES (?,?,?,?,?,?,?,?,?)',
            [uuidv4(),req.user.boutiqueId,date||today(req),'Sale '+num,'in',montant,mode_paiement||'Cash','Sales',id]);
    });
    res.json({ success: true, id, num });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.patch('/ventes/:id/markInvoicePaid', notSalesperson, (req, res) => {
  const v = get('SELECT * FROM ventes WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  if (!v) return res.status(404).json({ error: 'Sale not found' });
  if (v.statut === 'Paid') return res.status(400).json({ error: 'Already paid' });
  run("UPDATE ventes SET statut = 'Paid' WHERE id = ?", [req.params.id]);
  run('INSERT INTO mouvements (id,boutique_id,date,libelle,type,montant,mode,categorie,reference_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [uuidv4(),req.user.boutiqueId,today(req),'Receipt '+v.num,'in',v.montant,req.body.mode||v.mode_paiement||'Cash','Sales',v.id]);
  res.json({ success: true });
});
router.patch('/ventes/:id/annuler', notSalesperson, (req, res) => {
  const v = get('SELECT * FROM ventes WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  if (!v) return res.status(404).json({ error: 'Sale not found' });
  try {
    transaction(() => {
      run("UPDATE ventes SET statut = 'Cancelled' WHERE id = ?", [req.params.id]);
      const lignes = all('SELECT * FROM vente_lignes WHERE vente_id = ?', [req.params.id]);
      for (const l of lignes) {
        if (l.produit_id) {
          run('UPDATE produits SET stock = stock + ? WHERE id = ? AND boutique_id = ?', [l.quantite,l.produit_id,req.user.boutiqueId]);
          run('INSERT INTO stock_mouvements (id,boutique_id,produit_id,date,type,quantite,reference) VALUES (?,?,?,?,?,?,?)',
              [uuidv4(),req.user.boutiqueId,l.produit_id,today(req),'entree',l.quantite,'Cancellation '+v.num]);
        }
      }
      if (v.statut === 'Paid')
        run('INSERT INTO mouvements (id,boutique_id,date,libelle,type,montant,mode,categorie,reference_id) VALUES (?,?,?,?,?,?,?,?,?)',
            [uuidv4(),req.user.boutiqueId,today(req),'Credit note — cancellation '+v.num,'out',v.montant,'Cash','Credit note',v.id]);
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══ TREASURY ══
router.get('/mouvements', (req, res) => {
  const { from, to, type } = req.query;
  let sql = 'SELECT * FROM mouvements WHERE boutique_id = ?';
  const params = [req.user.boutiqueId];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to)   { sql += ' AND date <= ?'; params.push(to); }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  res.json({ mouvements: all(sql, params) });
});
router.post('/mouvements', notSalesperson, (req, res) => {
  const { date, libelle, type, montant, mode, compte, categorie } = req.body;
  if (!libelle || !montant || !type) return res.status(400).json({ error: 'Label, type and amount required' });
  const id = uuidv4();
  run('INSERT INTO mouvements (id,boutique_id,date,libelle,type,montant,mode,compte,categorie) VALUES (?,?,?,?,?,?,?,?,?)',
      [id,req.user.boutiqueId,date||today(req),libelle,type,montant,mode||'Cash',compte||'Main till',categorie||'']);
  res.json({ success: true, id });
});
router.get('/mouvements/stats', (req, res) => {
  const bId = req.user.boutiqueId;
  const enc = (get("SELECT COALESCE(SUM(montant),0) as v FROM mouvements WHERE boutique_id=? AND type='in'", [bId])||{v:0}).v;
  const dec = (get("SELECT COALESCE(SUM(montant),0) as v FROM mouvements WHERE boutique_id=? AND type='out'", [bId])||{v:0}).v;
  res.json({ entrees: enc, sorties: dec, solde: enc - dec });
});

// ══ EXPENSES ══
router.get('/depenses', (req, res) => {
  res.json({ depenses: all('SELECT * FROM depenses WHERE boutique_id = ? ORDER BY date DESC', [req.user.boutiqueId]) });
});
router.post('/depenses', notSalesperson, (req, res) => {
  const { date, libelle, categorie, montant, mode, recurrence } = req.body;
  if (!libelle || !montant) return res.status(400).json({ error: 'Label and amount required' });
  const id = uuidv4();
  transaction(() => {
    run('INSERT INTO depenses (id,boutique_id,date,libelle,categorie,montant,mode,recurrence) VALUES (?,?,?,?,?,?,?,?)',
        [id,req.user.boutiqueId,date||today(req),libelle,categorie||'Miscellaneous',montant,mode||'Cash',recurrence||'']);
    run('INSERT INTO mouvements (id,boutique_id,date,libelle,type,montant,mode,categorie,reference_id) VALUES (?,?,?,?,?,?,?,?,?)',
        [uuidv4(),req.user.boutiqueId,date||today(req),libelle,'out',montant,mode||'Cash',categorie||'Miscellaneous',id]);
  });
  res.json({ success: true, id });
});
router.delete('/depenses/:id', adminOnly, (req, res) => {
  run('DELETE FROM depenses WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});

// ══ EMPLOYEES ══
router.get('/employes', (req, res) => {
  res.json({ employes: all('SELECT * FROM employes WHERE boutique_id = ? AND actif = 1 ORDER BY nom', [req.user.boutiqueId]) });
});
router.post('/employes', adminOnly, (req, res) => {
  const { prenom, nom, poste, salaire, tel, date_embauche } = req.body;
  if (!prenom || !nom) return res.status(400).json({ error: 'First and last name required' });
  const id = uuidv4();
  run('INSERT INTO employes (id,boutique_id,prenom,nom,poste,salaire,tel,date_embauche) VALUES (?,?,?,?,?,?,?,?)',
      [id,req.user.boutiqueId,prenom,nom,poste||'',salaire||0,tel||'',date_embauche||today(req)]);
  res.json({ success: true, id });
});
router.put('/employes/:id', adminOnly, (req, res) => {
  const { prenom, nom, poste, salaire, tel, date_embauche, presence } = req.body;
  run('UPDATE employes SET prenom=?,nom=?,poste=?,salaire=?,tel=?,date_embauche=?,presence=? WHERE id=? AND boutique_id=?',
      [prenom,nom,poste||'',salaire||0,tel||'',date_embauche||'',presence!=null?presence:100,req.params.id,req.user.boutiqueId]);
  res.json({ success: true });
});
router.delete('/employes/:id', adminOnly, (req, res) => {
  run('UPDATE employes SET actif = 0 WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});

// ══ LEAVE ══
router.get('/conges', (req, res) => {
  res.json({ conges: all('SELECT c.*, e.poste FROM conges c LEFT JOIN employes e ON e.id=c.employe_id WHERE c.boutique_id=? ORDER BY c.date_debut DESC', [req.user.boutiqueId]) });
});
router.post('/conges', notSalesperson, (req, res) => {
  const { employe_id, type, date_debut, date_fin, statut, motif } = req.body;
  if (!employe_id || !date_debut || !date_fin) return res.status(400).json({ error: 'Employee and dates required' });
  const emp = get('SELECT prenom, nom FROM employes WHERE id = ?', [employe_id]);
  const id = uuidv4();
  run('INSERT INTO conges (id,boutique_id,employe_id,employe_nom,type,date_debut,date_fin,statut,motif) VALUES (?,?,?,?,?,?,?,?,?)',
      [id,req.user.boutiqueId,employe_id,emp?(emp.prenom+' '+emp.nom):'',type||'Paid leave',date_debut,date_fin,statut||'Pending',motif||'']);
  res.json({ success: true, id });
});
router.patch('/conges/:id', notSalesperson, (req, res) => {
  run('UPDATE conges SET statut = ? WHERE id = ? AND boutique_id = ?', [req.body.statut, req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});
router.delete('/conges/:id', adminOnly, (req, res) => {
  run('DELETE FROM conges WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});

// ══ RETURNS ══
router.get('/retours', (req, res) => {
  res.json({ retours: all('SELECT * FROM retours WHERE boutique_id = ? ORDER BY date DESC', [req.user.boutiqueId]) });
});
router.get('/retours/ticket/:numero', adminOnly, (req,res)=>{
  const vente=findTicketSale(req.user.boutiqueId,req.params.numero);
  if(!vente)return res.status(404).json({error:'Receipt not found'});
  let lignes=[];try{lignes=JSON.parse(vente.lignes)||[];}catch(_){}
  const brut=lignes.reduce((sum,l)=>sum+Number(l.t||Number(l.pu)*Number(l.q)||0),0);
  const enriched=lignes.map((l,index)=>{
    const deja=get("SELECT COALESCE(SUM(quantite),0) total FROM retours WHERE boutique_id=? AND ticket_ref=? AND produit_nom=? AND statut<>'Refused'",[req.user.boutiqueId,vente.numero,l.d]);
    const quantite=Number(l.q)||0,prixNet=brut>0?(Number(vente.montant)*Number(l.t||0)/brut/quantite):0;
    return {index,produit_id:l.productId||'',nom:l.d,quantite,quantite_disponible:Math.max(0,quantite-Number(deja?.total||0)),prix_net_unitaire:prixNet};
  });
  res.json({ticket:{id:vente.id,numero:vente.numero,client_nom:vente.client_nom,montant:Number(vente.montant),lignes:enriched}});
});
router.post('/retours', notSalesperson, (req, res) => {
  if(req.user.role!=='admin')return res.status(403).json({error:'A customer return must be approved by an administrator'});
  const {ticket_ref,ligne_index,quantite,motif,notes}=req.body,statut=req.body.statut||'Pending';
  if(!['Pending','Refunded','Exchanged','Refused'].includes(statut))return res.status(400).json({error:'Invalid return status'});
  const vente=findTicketSale(req.user.boutiqueId,ticket_ref);
  if(!vente)return res.status(404).json({error:'Receipt not found'});
  let lignes=[];try{lignes=JSON.parse(vente.lignes)||[];}catch(_){}
  const line=lignes[Number(ligne_index)],qty=Number(quantite);
  if(!line||!Number.isInteger(qty)||qty<1)return res.status(400).json({error:'Invalid product or quantity'});
  const deja=get("SELECT COALESCE(SUM(quantite),0) total FROM retours WHERE boutique_id=? AND ticket_ref=? AND produit_nom=? AND statut<>'Refused'",[req.user.boutiqueId,vente.numero,line.d]);
  if(qty+Number(deja?.total||0)>Number(line.q))return res.status(409).json({error:'The quantity exceeds what can still be returned on this receipt'});
  const brut=lignes.reduce((sum,l)=>sum+Number(l.t||Number(l.pu)*Number(l.q)||0),0);
  const montantCalcule=brut>0?Math.round(Number(vente.montant)*Number(line.t||0)/brut/Number(line.q)*qty):0;
  const montant=statut==='Refunded'?montantCalcule:0,id=uuidv4(),date=today(req);
  const state=readAppState(req.user.boutiqueId);if(!state)return res.status(409).json({error:'Shop data not initialised'});
  const retour={id:'R'+id.slice(0,8),date,ticket:vente.numero,vente_id:vente.id,nom:vente.client_nom||'Walk-in customer',produit:line.d,productId:line.productId||'',qty,type:'Customer',statut,motif:motif||'',montant,notes:notes||''};
  transaction(() => {
    run('INSERT INTO retours (id,boutique_id,date,vente_id,ticket_ref,client_nom,produit_nom,quantite,type,statut,motif,montant,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id,req.user.boutiqueId,date,vente.id,vente.numero,vente.client_nom||'',line.d,qty,'Customer',statut,motif||'',montant,notes||'']);
    state.retours=state.retours||[];state.retours.unshift(retour);
    state.mouvements=state.mouvements||[];
    if (statut === 'Refunded' && montant > 0) {
      run('INSERT INTO mouvements (id,boutique_id,date,libelle,type,montant,mode,categorie,reference_id) VALUES (?,?,?,?,?,?,?,?,?)',
          [uuidv4(),req.user.boutiqueId,date,'Refund — '+line.d,'out',montant,'Cash','Return',id]);
      state.mouvements.unshift({id:'MV'+uuidv4().slice(0,8),date,lib:'Return refund '+line.d,type:'out',montant,mode:'Cash',referenceId:id});
    }
    if(statut==='Refunded'||statut==='Exchanged'){
      const product=(state.produits||[]).find(p=>p.id===line.productId)||(state.produits||[]).find(p=>p.nom===line.d);
      if(product)product.stk=Number(product.stk)+qty;
    }
    run('UPDATE app_state SET data=?,updated_at=datetime(\'now\'),version=version+1 WHERE boutique_id=?',[JSON.stringify(state),req.user.boutiqueId]);
    run('INSERT INTO audit_log (id,boutique_id,user_id,action,details) VALUES (?,?,?,?,?)',[uuidv4(),req.user.boutiqueId,req.user.id,'RETURN_CREATE',JSON.stringify({ticket:vente.numero,produit:line.d,quantite:qty,statut,montant})]);
  });
  const version=Number(get('SELECT version FROM app_state WHERE boutique_id=?',[req.user.boutiqueId])?.version)||0;
  res.json({success:true,id,retour,state,version});
});
router.delete('/retours/:id', adminOnly, (req, res) => {
  run('DELETE FROM retours WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});

// ══ ORDERS ══
router.get('/commandes', (req, res) => {
  const commandes = all('SELECT * FROM commandes WHERE boutique_id = ? ORDER BY date DESC', [req.user.boutiqueId]);
  commandes.forEach(c => { c.lignes = all('SELECT * FROM commande_lignes WHERE commande_id = ?', [c.id]); });
  res.json({ commandes });
});
router.post('/commandes', adminOnly, (req, res) => {
  const { fournisseur_id, fournisseur_nom, date, date_livraison, statut, montant, lignes, notes } = req.body;
  if (!fournisseur_nom) return res.status(400).json({ error: 'Supplier required' });
  const countRow = get('SELECT COUNT(*) as n FROM commandes WHERE boutique_id = ?', [req.user.boutiqueId]);
  const num = 'CMD-' + appNow(req).getUTCFullYear() + '-' + String(((countRow||{n:0}).n) + 1).padStart(3,'0');
  const id = uuidv4();
  transaction(() => {
    run('INSERT INTO commandes (id,boutique_id,num,fournisseur_id,fournisseur_nom,date,date_livraison,statut,montant,notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id,req.user.boutiqueId,num,fournisseur_id||null,fournisseur_nom,date||today(req),date_livraison||'',statut||'Draft',montant||0,notes||'']);
    if (Array.isArray(lignes))
      for (const l of lignes)
        run('INSERT INTO commande_lignes (id,commande_id,produit_id,designation,quantite,prix_unitaire,total) VALUES (?,?,?,?,?,?,?)',
            [uuidv4(),id,l.produit_id||null,l.d||l.designation||'',l.q||l.quantite||1,l.pu||l.prix_unitaire||0,l.t||l.total||0]);
  });
  res.json({ success: true, id, num });
});
router.patch('/commandes/:id/recevoir', adminOnly, (req, res) => {
  const cmd = get('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  if (!cmd) return res.status(404).json({ error: 'Order not found' });
  if (cmd.statut === 'Received') return res.status(400).json({ error: 'Already received' });
  const facture = String(req.body.facture || '').trim();
  const dateReception = req.body.date || today(req);
  const frais = Math.max(0, Number(req.body.frais) || 0);
  const montant = Number(cmd.montant || 0) + frais;
  const montantPaye = Math.max(0, Number(req.body.montant_paye) || 0);
  const mode = req.body.mode || 'Cash';
  if (!facture) return res.status(400).json({ error: 'Supplier invoice number required' });
  if (montantPaye > montant) return res.status(400).json({ error: 'Payment exceeds the invoice total' });
  try {
    transaction(() => {
      run("UPDATE commandes SET statut='Received' WHERE id=?", [req.params.id]);
      if (cmd.fournisseur_id)
        run('UPDATE fournisseurs SET derniere_commande=? WHERE id=? AND boutique_id=?', [today(req),cmd.fournisseur_id,req.user.boutiqueId]);
      const lignes = all('SELECT * FROM commande_lignes WHERE commande_id = ?', [req.params.id]);
      for (const l of lignes) {
        if (l.produit_id) {
          run('UPDATE produits SET stock = stock + ? WHERE id = ? AND boutique_id = ?', [l.quantite,l.produit_id,req.user.boutiqueId]);
          run('INSERT INTO stock_mouvements (id,boutique_id,produit_id,date,type,quantite,reference) VALUES (?,?,?,?,?,?,?)',
              [uuidv4(),req.user.boutiqueId,l.produit_id,dateReception,'entree',l.quantite,facture]);
        }
      }
      const achatId = uuidv4(), solde = montant - montantPaye;
      run('INSERT INTO achats_fournisseurs (id,boutique_id,commande_id,facture,fournisseur_id,fournisseur_nom,date,montant,frais,montant_paye,statut) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [achatId,req.user.boutiqueId,cmd.id,facture,cmd.fournisseur_id,cmd.fournisseur_nom,dateReception,montant,frais,montantPaye,solde<=0?'Paid':montantPaye>0?'Partly paid':'To pay']);
      if (montant > 0) {
        run('INSERT INTO depenses (id,boutique_id,date,libelle,categorie,montant,mode) VALUES (?,?,?,?,?,?,?)',
            [uuidv4(),req.user.boutiqueId,dateReception,'Purchase — '+facture+' ('+cmd.fournisseur_nom+')','Stock purchase',montant,solde>0?'Supplier credit':mode]);
        run('INSERT INTO journal (id,boutique_id,date,libelle,piece,compte,type,montant) VALUES (?,?,?,?,?,?,?,?)',
            [uuidv4(),req.user.boutiqueId,dateReception,'Stock purchase '+facture,facture,'60','debit',montant]);
      }
      if (montantPaye > 0) {
        run('INSERT INTO paiements_fournisseurs (id,boutique_id,achat_id,date,montant,mode) VALUES (?,?,?,?,?,?)', [uuidv4(),req.user.boutiqueId,achatId,dateReception,montantPaye,mode]);
        run('INSERT INTO mouvements (id,boutique_id,date,libelle,type,montant,mode,categorie,reference_id) VALUES (?,?,?,?,?,?,?,?,?)',
            [uuidv4(),req.user.boutiqueId,dateReception,'Payment '+facture+' — '+cmd.fournisseur_nom,'out',montantPaye,mode,'Stock purchase',achatId]);
        run('INSERT INTO journal (id,boutique_id,date,libelle,piece,compte,type,montant) VALUES (?,?,?,?,?,?,?,?)', [uuidv4(),req.user.boutiqueId,dateReception,'Supplier payment '+facture,facture,'57','credit',montantPaye]);
      }
      if (solde > 0) run('INSERT INTO journal (id,boutique_id,date,libelle,piece,compte,type,montant) VALUES (?,?,?,?,?,?,?,?)', [uuidv4(),req.user.boutiqueId,dateReception,'Supplier debt '+facture,facture,'40','credit',solde]);
    });
    res.json({ success: true, facture, montant, montant_paye: montantPaye, reste_du: montant-montantPaye });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/achats', (req, res) => {
  res.json({ achats: all('SELECT * FROM achats_fournisseurs WHERE boutique_id = ? ORDER BY date DESC, created_at DESC', [req.user.boutiqueId]) });
});
router.post('/achats/:id/paiements', adminOnly, (req, res) => {
  const achat=get('SELECT * FROM achats_fournisseurs WHERE id=? AND boutique_id=?',[req.params.id,req.user.boutiqueId]);
  if(!achat)return res.status(404).json({error:'Supplier invoice not found'});
  const montant=Number(req.body.montant)||0,reste=Number(achat.montant)-Number(achat.montant_paye),date=req.body.date||today(req),mode=req.body.mode||'Cash';
  if(montant<=0||montant>reste)return res.status(400).json({error:'Invalid amount or greater than the debt'});
  transaction(()=>{
    const nouveauPaye=Number(achat.montant_paye)+montant,nouveauReste=Number(achat.montant)-nouveauPaye;
    run('UPDATE achats_fournisseurs SET montant_paye=?,statut=? WHERE id=?',[nouveauPaye,nouveauReste<=0?'Paid':'Partly paid',achat.id]);
    run('INSERT INTO paiements_fournisseurs (id,boutique_id,achat_id,date,montant,mode) VALUES (?,?,?,?,?,?)',[uuidv4(),req.user.boutiqueId,achat.id,date,montant,mode]);
    run('INSERT INTO mouvements (id,boutique_id,date,libelle,type,montant,mode,categorie,reference_id) VALUES (?,?,?,?,?,?,?,?,?)',[uuidv4(),req.user.boutiqueId,date,'Payment '+achat.facture+' — '+achat.fournisseur_nom,'out',montant,mode,'Supplier debt',achat.id]);
    run('INSERT INTO journal (id,boutique_id,date,libelle,piece,compte,type,montant) VALUES (?,?,?,?,?,?,?,?)',[uuidv4(),req.user.boutiqueId,date,'Debt payment '+achat.facture,achat.facture,'40','debit',montant]);
    run('INSERT INTO journal (id,boutique_id,date,libelle,piece,compte,type,montant) VALUES (?,?,?,?,?,?,?,?)',[uuidv4(),req.user.boutiqueId,date,'Treasury outflow '+achat.facture,achat.facture,'57','credit',montant]);
  });
  res.json({success:true,reste_du:reste-montant});
});
router.delete('/commandes/:id', adminOnly, (req, res) => {
  run('DELETE FROM commandes WHERE id = ? AND boutique_id = ?', [req.params.id, req.user.boutiqueId]);
  res.json({ success: true });
});

// ══ ACCOUNTING JOURNAL ══
router.get('/journal', (req, res) => {
  res.json({ journal: all('SELECT * FROM journal WHERE boutique_id = ? ORDER BY date DESC LIMIT 500', [req.user.boutiqueId]) });
});
router.post('/journal', accountingOnly, (req, res) => {
  const { date, libelle, piece, compte, type, montant } = req.body;
  if (!libelle || !montant || !compte || !type) return res.status(400).json({ error: 'Required fields missing' });
  const id = uuidv4();
  run('INSERT INTO journal (id,boutique_id,date,libelle,piece,compte,type,montant) VALUES (?,?,?,?,?,?,?,?)',
      [id,req.user.boutiqueId,date||today(req),libelle,piece||'',compte,type,montant]);
  res.json({ success: true, id });
});

// ══ DASHBOARD ══
/* ═══════════════ INTERNAL MESSAGING ═══════════════ */
router.get('/messagerie/utilisateurs',(req,res)=>{
  const users=all(`SELECT u.id,u.login,u.nom,u.role,
    (SELECT COUNT(*) FROM messagerie_messages m
      LEFT JOIN messagerie_etats e ON e.message_id=m.id AND e.utilisateur_id=?
      WHERE m.boutique_id=u.boutique_id AND m.expediteur_id=u.id AND m.destinataire_id=? AND e.lu_at IS NULL) non_lus
    FROM utilisateurs u WHERE u.boutique_id=? AND u.actif=1 AND u.id<>? ORDER BY u.nom,u.login`,
    [req.user.id,req.user.id,req.user.boutiqueId,req.user.id]);
  const general=get(`SELECT COUNT(*) non_lus FROM messagerie_messages m
    LEFT JOIN messagerie_etats e ON e.message_id=m.id AND e.utilisateur_id=?
    WHERE m.boutique_id=? AND m.destinataire_id IS NULL AND m.expediteur_id<>? AND e.lu_at IS NULL`,
    [req.user.id,req.user.boutiqueId,req.user.id]);
  res.json({utilisateurs:users,general_non_lus:Number(general?.non_lus||0),total_non_lus:Number(general?.non_lus||0)+users.reduce((n,u)=>n+Number(u.non_lus||0),0)});
});

router.get('/messagerie/messages',(req,res)=>{
  const contact=String(req.query.contact||'general'),params=[req.user.id,req.user.boutiqueId];
  let conversation='m.destinataire_id IS NULL';
  if(contact!=='general'){
    const user=get('SELECT id FROM utilisateurs WHERE id=? AND boutique_id=? AND actif=1',[contact,req.user.boutiqueId]);
    if(!user)return res.status(404).json({error:'User not found'});
    conversation='((m.expediteur_id=? AND m.destinataire_id=?) OR (m.expediteur_id=? AND m.destinataire_id=?))';
    params.push(req.user.id,contact,contact,req.user.id);
  }
  params.push(Math.min(200,Math.max(1,Number(req.query.limit)||100)));
  const messages=all(`SELECT m.*,u.nom expediteur_nom,u.login expediteur_login,u.role expediteur_role,
    e.lu_at,e.archive_at,
    (SELECT COUNT(*) FROM messagerie_etats er WHERE er.message_id=m.id AND er.utilisateur_id<>m.expediteur_id AND er.lu_at IS NOT NULL) lectures
    FROM messagerie_messages m JOIN utilisateurs u ON u.id=m.expediteur_id
    LEFT JOIN messagerie_etats e ON e.message_id=m.id AND e.utilisateur_id=?
    WHERE m.boutique_id=? AND ${conversation} AND e.archive_at IS NULL
    ORDER BY m.epingle DESC,m.created_at ASC LIMIT ?`,params);
  res.json({messages});
});

router.post('/messagerie/messages',(req,res)=>{
  const contenu=cleanMessageText(req.body.contenu),destinataireId=req.body.destinataire_id||null,ticketRef=String(req.body.ticket_ref||'').trim().slice(0,80);
  const attachment=req.body.attachment||null;
  if(!contenu&&!attachment)return res.status(400).json({error:'Write a message or add an attachment'});
  if(destinataireId&&!get('SELECT id FROM utilisateurs WHERE id=? AND boutique_id=? AND actif=1',[destinataireId,req.user.boutiqueId]))return res.status(404).json({error:'Recipient not found'});
  if(ticketRef&&!findTicketSale(req.user.boutiqueId,ticketRef))return res.status(404).json({error:'Receipt number not found'});
  let pieceNom=null,pieceType=null,pieceData=null;
  if(attachment){
    pieceNom=String(attachment.nom||'attachment').slice(0,120);pieceType=String(attachment.type||'');pieceData=String(attachment.data||'');
    if(!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(pieceType)||!pieceData.startsWith('data:'+pieceType+';base64,')||pieceData.length>1400000)return res.status(400).json({error:'Attachment invalid or larger than 1 MB'});
  }
  const id=uuidv4();
  run('INSERT INTO messagerie_messages (id,boutique_id,expediteur_id,destinataire_id,contenu,ticket_ref,piece_nom,piece_type,piece_data) VALUES (?,?,?,?,?,?,?,?,?)',
    [id,req.user.boutiqueId,req.user.id,destinataireId,contenu,ticketRef,pieceNom,pieceType,pieceData]);
  run('INSERT INTO audit_log (id,boutique_id,user_id,action,details) VALUES (?,?,?,?,?)',[uuidv4(),req.user.boutiqueId,req.user.id,'MESSAGE_SENT',JSON.stringify({message_id:id,canal:destinataireId?'private':'general',ticket_ref:ticketRef||null})]);
  res.json({success:true,id});
});

router.patch('/messagerie/lire',(req,res)=>{
  const contact=String(req.body.contact||'general'),params=[req.user.boutiqueId,req.user.id];
  let conversation='destinataire_id IS NULL';
  if(contact!=='general'){conversation='expediteur_id=? AND destinataire_id=?';params.push(contact,req.user.id);}
  const messages=all(`SELECT id FROM messagerie_messages WHERE boutique_id=? AND expediteur_id<>? AND ${conversation}`,params);
  transaction(()=>messages.forEach(m=>run(`INSERT INTO messagerie_etats(message_id,utilisateur_id,lu_at) VALUES (?,?,datetime('now'))
    ON CONFLICT(message_id,utilisateur_id) DO UPDATE SET lu_at=datetime('now')`,[m.id,req.user.id])));
  res.json({success:true,lus:messages.length});
});

router.patch('/messagerie/messages/:id/archiver',(req,res)=>{
  const m=get(`SELECT id FROM messagerie_messages WHERE id=? AND boutique_id=? AND
    (destinataire_id IS NULL OR expediteur_id=? OR destinataire_id=?)`,[req.params.id,req.user.boutiqueId,req.user.id,req.user.id]);
  if(!m)return res.status(404).json({error:'Message not found'});
  run(`INSERT INTO messagerie_etats(message_id,utilisateur_id,lu_at,archive_at) VALUES (?,?,datetime('now'),datetime('now'))
    ON CONFLICT(message_id,utilisateur_id) DO UPDATE SET archive_at=datetime('now'),lu_at=COALESCE(lu_at,datetime('now'))`,[m.id,req.user.id]);
  res.json({success:true});
});

router.patch('/messagerie/messages/:id/epingler',adminOnly,(req,res)=>{
  const value=req.body.epingle?1:0;
  const m=get('SELECT id FROM messagerie_messages WHERE id=? AND boutique_id=?',[req.params.id,req.user.boutiqueId]);
  if(!m)return res.status(404).json({error:'Message not found'});
  run('UPDATE messagerie_messages SET epingle=? WHERE id=?',[value,m.id]);res.json({success:true});
});

router.get('/dashboard', (req, res) => {
  const bId = req.user.boutiqueId;
  const td = today(req);
  const sg = (sql, p) => { try { return get(sql, p) || {}; } catch(e) { return {}; } };
  const sa = (sql, p) => { try { return all(sql, p); } catch(e) { return []; } };
  const v = (obj) => obj.v || 0;

  const kpis = {
    ca_today:     v(sg("SELECT COALESCE(SUM(montant),0) as v FROM ventes WHERE boutique_id=? AND date=? AND statut='Paid'", [bId,td])),
    enc_today:    v(sg("SELECT COALESCE(SUM(montant),0) as v FROM mouvements WHERE boutique_id=? AND date=? AND type='in'", [bId,td])),
    dec_today:    v(sg("SELECT COALESCE(SUM(montant),0) as v FROM mouvements WHERE boutique_id=? AND date=? AND type='out'", [bId,td])),
    tx_today:     v(sg('SELECT COUNT(*) as v FROM ventes WHERE boutique_id=? AND date=?', [bId,td])),
    alerts:       v(sg('SELECT COUNT(*) as v FROM produits WHERE boutique_id=? AND actif=1 AND stock<=stock_min', [bId])),
    valeur_stock: v(sg('SELECT COALESCE(SUM(stock*prix_achat),0) as v FROM produits WHERE boutique_id=? AND actif=1', [bId])),
    nb_prods:     v(sg('SELECT COUNT(*) as v FROM produits WHERE boutique_id=? AND actif=1', [bId])),
    nb_clients:   v(sg('SELECT COUNT(*) as v FROM clients WHERE boutique_id=?', [bId])),
    nb_fourn:     v(sg('SELECT COUNT(*) as v FROM fournisseurs WHERE boutique_id=?', [bId])),
    nb_emp:       v(sg('SELECT COUNT(*) as v FROM employes WHERE boutique_id=? AND actif=1', [bId])),
    non_enc:      v(sg("SELECT COALESCE(SUM(montant),0) as v FROM ventes WHERE boutique_id=? AND statut='Pending'", [bId])),
    rupt:         v(sg('SELECT COUNT(*) as v FROM produits WHERE boutique_id=? AND actif=1 AND stock=0', [bId])),
    low_stk:      v(sg('SELECT COUNT(*) as v FROM produits WHERE boutique_id=? AND actif=1 AND stock>0 AND stock<=stock_min', [bId])),
    fac_att:      v(sg("SELECT COUNT(*) as v FROM ventes WHERE boutique_id=? AND statut='Pending'", [bId])),
    dettes_cli:   v(sg('SELECT COUNT(*) as v FROM clients WHERE boutique_id=? AND solde>0', [bId])),
    enc_total:    v(sg("SELECT COALESCE(SUM(montant),0) as v FROM mouvements WHERE boutique_id=? AND type='in'", [bId])),
    dec_total:    v(sg("SELECT COALESCE(SUM(montant),0) as v FROM mouvements WHERE boutique_id=? AND type='out'", [bId])),
  };
  kpis.solde = kpis.enc_total - kpis.dec_total;
  kpis.benef = kpis.enc_today - kpis.dec_today;

  const top_prods = sa("SELECT vl.designation as nom, SUM(vl.quantite) as qty, SUM(vl.total) as ca FROM vente_lignes vl JOIN ventes v ON v.id=vl.vente_id WHERE v.boutique_id=? AND v.statut='Paid' AND v.date>=date('now','-30 days') GROUP BY vl.designation ORDER BY ca DESC LIMIT 5", [bId]);
  const activites = sa("SELECT 'vente' as type, num as ref, client_nom as detail, montant, created_at FROM ventes WHERE boutique_id=? ORDER BY created_at DESC LIMIT 10", [bId]);
  const ventes_6m = sa("SELECT substr(date,1,7) as mois, SUM(montant) as total, COUNT(*) as nb FROM ventes WHERE boutique_id=? AND statut='Paid' AND date>=date('now','-6 months') GROUP BY mois ORDER BY mois", [bId]);
  const depenses_cat = sa("SELECT categorie, SUM(montant) as total FROM depenses WHERE boutique_id=? GROUP BY categorie ORDER BY total DESC LIMIT 5", [bId]);

  res.json({ kpis, top_prods, activites, ventes_6m, depenses_cat });
});

module.exports = router;
