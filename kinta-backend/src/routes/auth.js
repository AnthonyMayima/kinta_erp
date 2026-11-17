'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { run, get, all, transaction } = require('../../database/schema');
const { generateToken, authMiddleware } = require('../middleware/auth');

const today = () => new Date().toISOString().split('T')[0];

router.get('/config', (req,res) => res.json({
  registration_enabled: process.env.ALLOW_BOUTIQUE_REGISTRATION === 'true',
  test_clock_enabled: process.env.ALLOW_TEST_CLOCK === 'true'
}));

// POST /api/auth/register — Create a new shop
router.post('/register', async (req, res) => {
  if(process.env.ALLOW_BOUTIQUE_REGISTRATION !== 'true')
    return res.status(403).json({error:'Shop creation is disabled on this server'});
  const { boutique_nom, boutique_adresse, boutique_ville, admin_login, admin_password, admin_nom } = req.body;
  if (!boutique_nom || !admin_login || !admin_password)
    return res.status(400).json({ error: 'Shop name, username and password required' });
  if (admin_password.length < 8)
    return res.status(400).json({ error: 'Password too short (min 8 characters)' });
  try {
    const boutiqueId = uuidv4(), adminId = uuidv4();
    const hash = await bcrypt.hash(admin_password, 12);
    const start=new Date(),end=new Date(start);end.setDate(end.getDate()+90);
    const emptyState={
      settings:{nom:boutique_nom,adresse:boutique_adresse||'',ville:boutique_ville||'',tel:'',email:'',rccm:'',niu:'',devise:'ZAR',tva:15,mentions:''},
      clients:[],produits:[],fournisseurs:[],factures:[],mouvements:[],depenses:[],employes:[],
      pos_day:{count:0,ca:0,cash:0,mm:0},inventaires:[],reglements_clients:[],admin_notifications:[],
      conges:[],journal:[],commandes:[],achats:[],retours:[]
    };
    transaction(()=>{
      run('INSERT INTO boutiques (id,nom,adresse,ville,tva,devise,couleur) VALUES (?,?,?,?,15,"ZAR","#16a34a")',
          [boutiqueId, boutique_nom, boutique_adresse||'', boutique_ville||'Johannesburg']);
      run('INSERT INTO utilisateurs (id,boutique_id,login,password_hash,role,nom) VALUES (?,?,?,?,"admin",?)',
          [adminId, boutiqueId, admin_login, hash, admin_nom||admin_login]);
      run('INSERT INTO abonnements (boutique_id,formule,statut,debut,fin,prix_mensuel,limite_utilisateurs) VALUES (?,?,?,?,?,?,?)',
          [boutiqueId,'test','active',start.toISOString(),end.toISOString(),0,5]);
      run('INSERT INTO app_state (boutique_id,data) VALUES (?,?)',[boutiqueId,JSON.stringify(emptyState)]);
    });
    const token = generateToken({ userId: adminId, boutiqueId, role: 'admin' });
    res.json({ success: true, token, user: { id: adminId, login: admin_login, role: 'admin', nom: admin_nom||admin_login, boutiqueId, boutiqueNom: boutique_nom } });
  } catch(e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken in this shop' });
    console.error(e); res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { login, password, boutique_id } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    let user;
    if (boutique_id) {
      user = get('SELECT u.*, b.nom as boutique_nom FROM utilisateurs u JOIN boutiques b ON u.boutique_id=b.id WHERE u.login=? AND u.boutique_id=? AND u.actif=1', [login, boutique_id]);
    } else {
      user = get('SELECT u.*, b.nom as boutique_nom FROM utilisateurs u JOIN boutiques b ON u.boutique_id=b.id WHERE u.login=? AND u.actif=1', [login]);
    }
    if (!user) return res.status(401).json({ error: 'Incorrect username or password' });
    const subscription=get('SELECT * FROM abonnements WHERE boutique_id=?',[user.boutique_id]);
    if(subscription?.statut==='suspended')return res.status(403).json({error:'Business suspended. Contact Kinta.'});
    if(subscription&&new Date(subscription.fin)<new Date())return res.status(402).json({error:'Subscription expired. Renew your Kinta plan.'});
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect username or password' });
    const token = generateToken({ userId: user.id, boutiqueId: user.boutique_id, role: user.role });
    res.json({ success: true, token, user: { id: user.id, login: user.login, role: user.role, nom: user.nom||user.login, boutiqueId: user.boutique_id, boutiqueNom: user.boutique_nom }, abonnement:subscription });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const boutique = get('SELECT * FROM boutiques WHERE id = ?', [req.user.boutiqueId]);
  res.json({ user: req.user, boutique });
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password || new_password.length < 8)
    return res.status(400).json({ error: 'Current and new password required (min 8 chars)' });
  const user = get('SELECT * FROM utilisateurs WHERE id = ?', [req.user.id]);
  const ok = await bcrypt.compare(old_password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password incorrect' });
  const hash = await bcrypt.hash(new_password, 12);
  run('UPDATE utilisateurs SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
  res.json({ success: true, message: 'Password changed successfully' });
});

// GET /api/auth/boutiques — list to choose from at sign-in
router.get('/boutiques', (req, res) => {
  const boutiques = all('SELECT id, nom, ville FROM boutiques ORDER BY nom');
  res.json({ boutiques });
});

module.exports = router;
