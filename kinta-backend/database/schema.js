'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { migrateToEnglish } = require('./english-migration');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'kinta.db');
let db = null;
let SQL = null;
let transactionDepth = 0;

async function getDB() {
  if (db) return db;
  SQL = await initSqlJs();
  
  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  // Enable WAL equivalent pragma
  db.run("PRAGMA foreign_keys = ON;");
  
  initSchema();
  return db;
}

// Save DB to disk (called after every write)
function saveDB() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function run(sql, params = []) {
  db.run(sql, params);
  if (transactionDepth === 0) saveDB();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function transaction(fn) {
  db.run("BEGIN TRANSACTION;");
  transactionDepth++;
  try {
    fn();
    db.run("COMMIT;");
    transactionDepth--;
    saveDB();
  } catch(e) {
    transactionDepth--;
    try { db.run("ROLLBACK;"); } catch (_) {}
    throw e;
  }
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS boutiques (
      id TEXT PRIMARY KEY, nom TEXT NOT NULL, slogan TEXT, adresse TEXT, ville TEXT,
      tel TEXT, email TEXT, web TEXT, rccm TEXT, niu TEXT,
      tva REAL DEFAULT 15, devise TEXT DEFAULT 'ZAR', couleur TEXT DEFAULT '#16a34a',
      logo TEXT, mentions TEXT, test_clock_offset_ms REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, login TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL, nom TEXT, actif INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(boutique_id, login)
    );
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, nom TEXT NOT NULL,
      tel TEXT, email TEXT, ville TEXT DEFAULT 'Brazzaville', adresse TEXT,
      type TEXT DEFAULT 'Retailer', solde REAL DEFAULT 0, credit REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS produits (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, nom TEXT NOT NULL,
      ref TEXT, barcode TEXT, categorie TEXT DEFAULT 'Food', sous_categorie TEXT,
      stock INTEGER DEFAULT 0, stock_min INTEGER DEFAULT 10,
      prix_achat REAL DEFAULT 0, prix_vente REAL DEFAULT 0,
      lot TEXT, date_expiry TEXT, actif INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS fournisseurs (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, nom TEXT NOT NULL,
      tel TEXT, email TEXT, categorie TEXT, adresse TEXT, derniere_commande TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ventes (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, num TEXT NOT NULL,
      client_id TEXT, client_nom TEXT, date TEXT NOT NULL, echeance TEXT,
      montant REAL NOT NULL, remise REAL DEFAULT 0, statut TEXT DEFAULT 'Pending',
      mode_paiement TEXT DEFAULT 'Cash', caissier_id TEXT, caissier_nom TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vente_lignes (
      id TEXT PRIMARY KEY, vente_id TEXT NOT NULL, produit_id TEXT,
      designation TEXT NOT NULL, quantite REAL NOT NULL, prix_unitaire REAL NOT NULL, total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mouvements (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, date TEXT NOT NULL,
      libelle TEXT NOT NULL, type TEXT NOT NULL, montant REAL NOT NULL,
      mode TEXT DEFAULT 'Cash', compte TEXT DEFAULT 'Main till',
      categorie TEXT, reference_id TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS depenses (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, date TEXT NOT NULL,
      libelle TEXT NOT NULL, categorie TEXT DEFAULT 'Miscellaneous', montant REAL NOT NULL,
      mode TEXT DEFAULT 'Cash', recurrence TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS employes (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, prenom TEXT NOT NULL,
      nom TEXT NOT NULL, poste TEXT, salaire REAL DEFAULT 0, tel TEXT,
      date_embauche TEXT, presence INTEGER DEFAULT 100, actif INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conges (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, employe_id TEXT NOT NULL,
      employe_nom TEXT, type TEXT DEFAULT 'Paid leave',
      date_debut TEXT NOT NULL, date_fin TEXT NOT NULL,
      statut TEXT DEFAULT 'Pending', motif TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS retours (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, date TEXT NOT NULL,
      vente_id TEXT, ticket_ref TEXT, client_nom TEXT, produit_nom TEXT,
      quantite INTEGER DEFAULT 1, type TEXT DEFAULT 'Customer',
      statut TEXT DEFAULT 'Pending', motif TEXT, montant REAL DEFAULT 0, notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS commandes (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, num TEXT NOT NULL,
      fournisseur_id TEXT, fournisseur_nom TEXT, date TEXT NOT NULL,
      date_livraison TEXT, statut TEXT DEFAULT 'Draft', montant REAL DEFAULT 0, notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS commande_lignes (
      id TEXT PRIMARY KEY, commande_id TEXT NOT NULL, produit_id TEXT,
      designation TEXT NOT NULL, quantite REAL NOT NULL, prix_unitaire REAL NOT NULL, total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS achats_fournisseurs (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, commande_id TEXT,
      facture TEXT NOT NULL, fournisseur_id TEXT, fournisseur_nom TEXT,
      date TEXT NOT NULL, montant REAL NOT NULL, frais REAL DEFAULT 0,
      montant_paye REAL DEFAULT 0, statut TEXT DEFAULT 'To pay',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(boutique_id, facture)
    );
    CREATE TABLE IF NOT EXISTS paiements_fournisseurs (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, achat_id TEXT NOT NULL,
      date TEXT NOT NULL, montant REAL NOT NULL, mode TEXT DEFAULT 'Cash',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS caisse_sessions (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, utilisateur_id TEXT NOT NULL,
      utilisateur_nom TEXT, ouverte_le TEXT DEFAULT (datetime('now')),
      fonds_initial REAL DEFAULT 0, statut TEXT DEFAULT 'open',
      fermee_le TEXT, especes_theoriques REAL DEFAULT 0, especes_comptees REAL,
      ecart REAL DEFAULT 0, total_ventes REAL DEFAULT 0, ventes_especes REAL DEFAULT 0,
      ventes_mobile REAL DEFAULT 0, nombre_ventes INTEGER DEFAULT 0, rapport_z TEXT
    );
    CREATE TABLE IF NOT EXISTS caisse_ventes (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, session_id TEXT NOT NULL,
      numero TEXT NOT NULL, montant REAL NOT NULL, mode TEXT NOT NULL,
      remise REAL DEFAULT 0, client_nom TEXT, lignes TEXT NOT NULL,
      cree_le TEXT DEFAULT (datetime('now')),
      UNIQUE(boutique_id, numero)
    );
    CREATE TABLE IF NOT EXISTS journal (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, date TEXT NOT NULL,
      libelle TEXT NOT NULL, piece TEXT, compte TEXT NOT NULL,
      type TEXT NOT NULL, montant REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stock_mouvements (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, produit_id TEXT NOT NULL,
      date TEXT NOT NULL, type TEXT NOT NULL, quantite INTEGER NOT NULL,
      reference TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS app_state (
      boutique_id TEXT PRIMARY KEY, data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')), version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, user_id TEXT,
      action TEXT NOT NULL, details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messagerie_messages (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, expediteur_id TEXT NOT NULL,
      destinataire_id TEXT, contenu TEXT, ticket_ref TEXT,
      piece_nom TEXT, piece_type TEXT, piece_data TEXT,
      epingle INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messagerie_etats (
      message_id TEXT NOT NULL, utilisateur_id TEXT NOT NULL,
      lu_at TEXT, archive_at TEXT,
      PRIMARY KEY(message_id, utilisateur_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messagerie_boutique_date ON messagerie_messages(boutique_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messagerie_destinataire ON messagerie_messages(destinataire_id, created_at);
    CREATE TABLE IF NOT EXISTS kinta_admins (
      id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      nom TEXT NOT NULL, role TEXT NOT NULL, actif INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS abonnements (
      boutique_id TEXT PRIMARY KEY, formule TEXT DEFAULT 'trial', statut TEXT DEFAULT 'active',
      debut TEXT NOT NULL, fin TEXT NOT NULL, prix_mensuel REAL DEFAULT 0,
      limite_utilisateurs INTEGER DEFAULT 2, suspendu_le TEXT, motif_suspension TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS paiements_abonnements (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, montant REAL NOT NULL,
      methode TEXT NOT NULL, reference TEXT, periode_debut TEXT, periode_fin TEXT,
      statut TEXT DEFAULT 'confirmed', recu_num TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS demandes_assistance (
      id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, admin_kinta_id TEXT NOT NULL,
      motif TEXT NOT NULL, statut TEXT DEFAULT 'pending', demande_le TEXT DEFAULT (datetime('now')),
      approuve_par TEXT, approuve_le TEXT, expire_le TEXT, utilise_le TEXT
    );
    CREATE TABLE IF NOT EXISTS kinta_audit (
      id TEXT PRIMARY KEY, admin_kinta_id TEXT, boutique_id TEXT,
      action TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration for databases created before concurrency control was added.
  const appStateColumns = all('PRAGMA table_info(app_state)');
  if (!appStateColumns.some(column => column.name === 'version'))
    db.run('ALTER TABLE app_state ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
  const boutiqueColumns = all('PRAGMA table_info(boutiques)');
  if (!boutiqueColumns.some(column => column.name === 'test_clock_offset_ms'))
    db.run('ALTER TABLE boutiques ADD COLUMN test_clock_offset_ms REAL');
  // Data created when Kinta stored its values in French.
  if (migrateToEnglish(db)) console.log('Stored values converted to English');

  // Development account only. In production, the credentials must be
  // supplied explicitly through environment variables.
  const existing = get('SELECT COUNT(*) AS n FROM boutiques');
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'kinta2026' : '');
  if (existing && existing.n === 0 && adminPassword) {
    const boutiqueId = uuidv4();
    const adminId = uuidv4();
    const adminLogin = process.env.INITIAL_ADMIN_LOGIN || 'admin';
    const boutiqueNom = process.env.INITIAL_BOUTIQUE_NAME || 'Poto-Poto Shop';
    db.run('INSERT INTO boutiques (id,nom,ville) VALUES (?,?,?)', [boutiqueId, boutiqueNom, 'Brazzaville']);
    db.run('INSERT INTO utilisateurs (id,boutique_id,login,password_hash,role,nom) VALUES (?,?,?,?,?,?)',
      [adminId, boutiqueId, adminLogin, bcrypt.hashSync(adminPassword, 12), 'admin', 'Manager']);
  }
  const shops = all('SELECT id FROM boutiques');
  for (const shop of shops) {
    const subscription = get('SELECT boutique_id FROM abonnements WHERE boutique_id=?',[shop.id]);
    if (!subscription) {
      const start=new Date(),end=new Date(start);end.setDate(end.getDate()+30);
      db.run('INSERT INTO abonnements (boutique_id,formule,statut,debut,fin,prix_mensuel,limite_utilisateurs) VALUES (?,?,?,?,?,?,?)',
        [shop.id,'trial','active',start.toISOString(),end.toISOString(),0,2]);
    }
  }
  const centralLogin=process.env.KINTA_ADMIN_LOGIN||'kinta-admin';
  const centralPassword=process.env.KINTA_ADMIN_PASSWORD||(process.env.NODE_ENV!=='production'?'kinta-admin-2026':'');
  if(centralPassword&&!get('SELECT id FROM kinta_admins WHERE login=?',[centralLogin]))
    db.run('INSERT INTO kinta_admins (id,login,password_hash,nom,role) VALUES (?,?,?,?,?)',[uuidv4(),centralLogin,bcrypt.hashSync(centralPassword,12),'Super administrator','super_admin']);
  saveDB();
  console.log('✅ Database schema initialised');
}

module.exports = { getDB, run, get, all, transaction, saveDB };
