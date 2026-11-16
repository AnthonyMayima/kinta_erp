'use strict';

// Kinta used to store statuses, payment methods, categories and roles in French.
// This migration rewrites those stored values in English so that data created
// before the English switch keeps working. It only touches values found in the
// maps below, so it is safe to run on every start-up.

// Values shown to users (statuses, payment methods, categories, reasons...).
const VALUES = {
  "Payée":"Paid","En attente":"Pending","Détaillant":"Retailer","Grossiste":"Wholesaler",
  "Particulier":"Individual","Congé payé":"Paid leave","Maladie":"Sick leave","Maternité":"Maternity leave",
  "Sans solde":"Unpaid leave","Approuvé":"Approved","Refusé":"Refused","Client":"Customer",
  "Fournisseur":"Supplier","Remboursé":"Refunded","Échangé":"Exchanged","Espèces":"Cash",
  "Virement":"Bank transfer","Alimentation":"Food","Hygiène":"Hygiene","Boissons":"Drinks",
  "Quincaillerie":"Hardware","Électronique":"Electronics","Textile":"Textiles",
  "Matériaux BTP":"Building materials","Autre":"Other","BTP":"Construction","Achat de stock":"Stock purchase",
  "Loyer":"Rent","Salaires":"Salaries","Électricité":"Electricity","Autres":"Other",
  "Produit défectueux":"Defective product","Mauvais produit livré":"Wrong product delivered",
  "Produit périmé":"Expired product","Erreur de quantité":"Quantity error",
  "Insatisfaction client":"Customer dissatisfaction","Brouillon":"Draft","Envoyée":"Sent",
  "Confirmée":"Confirmed","Céréales & Féculents":"Cereals & starches","Huiles & Graisses":"Oils & fats",
  "Épicerie sèche":"Dry groceries","Entretien ménager":"Household cleaning","Produits laitiers":"Dairy",
  "Eaux & Softs":"Water & soft drinks","Carte bancaire":"Bank card","Annulée":"Cancelled","Reçue":"Received",
  "Crédit":"Credit","À crédit":"On credit","Conserves":"Canned goods","Hygiène personnelle":"Personal care",
  "Produits bébé":"Baby products","Désinfectants":"Disinfectants","Jus de fruits":"Fruit juice",
  "Boissons énergisantes":"Energy drinks","Alcools":"Alcohol","Articles de maison":"Household items",
  "Outils":"Tools","Visserie":"Screws & bolts","Téléphones":"Phones","Accessoires":"Accessories",
  "Informatique":"Computing","Vêtements homme":"Men's clothing","Vêtements femme":"Women's clothing",
  "Enfants":"Children","Tissu":"Fabric","Ciment & Mortier":"Cement & mortar","Peinture":"Paint",
  "Tuyauterie":"Plumbing","Carrelage":"Tiling","Divers":"Miscellaneous","Achat":"Purchase","Vente":"Sale",
  "Caisse principale":"Main till","À payer":"To pay","Virement bancaire":"Bank transfer",
  "Crédit fournisseur":"Supplier credit","Magasinier":"Storekeeper","Vendeuse":"Salesperson",
  "Comptable":"Accountant","Livreur":"Delivery driver","Retour":"Return",
  "Transfert interne":"Internal transfer","Caissière":"Cashier","Caissier":"Cashier","Vendeur":"Salesperson"
};

// Internal codes (never displayed as-is).
const CODES = {
  caissier:'cashier', vendeur:'salesperson', comptable:'accountant',
  ouverte:'open', fermee:'closed', actif:'active', suspendu:'suspended', essai:'trial',
  approuvee:'approved', refusee:'refused', en_attente:'pending', 'confirmé':'confirmed',
};

// Old audit action names.
const ACTIONS = {
  CAISSE_CLOTURE:'TILL_CLOSED', COMMERCE_SUSPENDU:'BUSINESS_SUSPENDED', COMMERCE_REACTIVE:'BUSINESS_REACTIVATED',
  COMMERCE_CREE:'BUSINESS_CREATED', CONNEXION:'SIGN_IN', FORMULE_MODIFIEE:'PLAN_CHANGED',
  MDP_ADMIN_REINITIALISE:'ADMIN_PASSWORD_RESET', PAIEMENT_ABONNEMENT:'SUBSCRIPTION_PAYMENT',
  ASSISTANCE_DEMANDEE:'SUPPORT_REQUESTED', ASSISTANCE_OUVERTE:'SUPPORT_OPENED', AGENT_CREE:'AGENT_CREATED',
  MESSAGE_ENVOYE:'MESSAGE_SENT', ASSISTANCE_APPROUVEE:'SUPPORT_APPROVED', ASSISTANCE_REFUSEE:'SUPPORT_REFUSED',
};

// Table columns holding displayed values, and those holding internal codes.
const VALUE_COLUMNS = {
  ventes:['statut','mode_paiement'], mouvements:['mode','compte','categorie'], depenses:['categorie','mode'],
  clients:['type'], produits:['categorie','sous_categorie'], conges:['type','statut'],
  retours:['type','statut','motif'], commandes:['statut'], achats_fournisseurs:['statut'],
  paiements_fournisseurs:['mode'], caisse_ventes:['mode'], employes:['poste'],
};
const CODE_COLUMNS = {
  utilisateurs:['role'], kinta_admins:['role'], caisse_sessions:['statut'], abonnements:['statut','formule'],
  paiements_abonnements:['statut'], demandes_assistance:['statut'],
};
// Keys of the shared application state (app_state.data) holding displayed values.
const STATE_KEYS = new Set(['statut','mode','type','cat','scat','categorie','motif','poste','compte','mode_paiement']);
// Treasury account codes stored on movements.
const ACCOUNT_KEYS = new Set(['account','sourceAccount','destinationAccount']);
const ACCOUNTS = { caisse:'till', banque:'bank' };

function translateState(value, key) {
  if (Array.isArray(value)) return value.map(item => translateState(item, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = translateState(v, k);
    return out;
  }
  if (typeof value === 'string' && STATE_KEYS.has(key) && Object.prototype.hasOwnProperty.call(VALUES, value)) return VALUES[value];
  if (typeof value === 'string' && ACCOUNT_KEYS.has(key) && Object.prototype.hasOwnProperty.call(ACCOUNTS, value)) return ACCOUNTS[value];
  return value;
}

function migrateColumns(db, columns, map) {
  for (const [table, cols] of Object.entries(columns))
    for (const col of cols)
      for (const [fr, en] of Object.entries(map))
        db.run(`UPDATE ${table} SET ${col}=? WHERE ${col}=?`, [en, fr]);
}

// Returns true when something was changed.
function migrateToEnglish(db) {
  let changed = false;
  const run = (sql, params) => { db.run(sql, params); if (db.getRowsModified() > 0) changed = true; };
  const wrapped = { run };
  migrateColumns(wrapped, VALUE_COLUMNS, VALUES);
  migrateColumns(wrapped, CODE_COLUMNS, CODES);
  for (const [fr, en] of Object.entries(ACTIONS)) {
    run('UPDATE audit_log SET action=? WHERE action=?', [en, fr]);
    run('UPDATE kinta_audit SET action=? WHERE action=?', [en, fr]);
  }
  const stmt = db.prepare('SELECT boutique_id, data FROM app_state');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  for (const row of rows) {
    let state;
    try { state = JSON.parse(row.data); } catch (_) { continue; }
    const translated = JSON.stringify(translateState(state, ''));
    if (translated !== row.data) { db.run('UPDATE app_state SET data=?, version=version+1 WHERE boutique_id=?', [translated, row.boutique_id]); changed = true; }
  }
  return changed;
}

module.exports = { migrateToEnglish, translateState, VALUES, CODES };
