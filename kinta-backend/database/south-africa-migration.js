'use strict';

// Kinta's demo data was written for Congo-Brazzaville: +242 phone numbers,
// Congolese cities and names, Mobile Money (MTN/Airtel), RCCM numbers and
// 18% VAT. This migration moves stored data to the South African market:
// +27 numbers, South African cities and names, e-wallets and 15% VAT.
// It runs once per database (tracked with PRAGMA user_version) so that
// names typed later by users are never rewritten.

const MIGRATION_VERSION = 1;

// Whole or partial text replacements, longest first.
const REPLACEMENTS = [
  // Payment methods
  ['Mobile Money (MTN)', 'E-wallet (SnapScan)'],
  ['Mobile Money (Airtel)', 'E-wallet (Zapper)'],
  ['MTN Mobile Money', 'E-wallet (SnapScan)'],
  ['Airtel Money', 'E-wallet (Zapper)'],
  ['Mobile Money', 'E-wallet'],
  // Shop
  ['Poto-Poto Shop', 'Soweto Shop'],
  ['Poto-Poto, Brazzaville', 'Vilakazi Street, Orlando West, Soweto'],
  ['Poto-Poto', 'Soweto'],
  // Customers
  ['Épicerie Maman Ngo', "Mama Thandi's Spaza"],
  ['Maman Ngo Grocery', "Mama Thandi's Spaza"],
  ['Commerce Général Mbemba', 'Dlamini General Dealer'],
  ['Commerce Mbemba', 'Dlamini General Dealer'],
  ['Dist. Bouanga & Fils', 'Nkosi & Sons Distributors'],
  ['Marché Central SARL', 'Central Market (Pty) Ltd'],
  ['Épicerie Mama Rose', 'Mama Rose Tuck Shop'],
  ['ngo@gmail.com', 'thandi@gmail.com'],
  ['mbemba@yahoo.fr', 'dlamini@webmail.co.za'],
  // Suppliers
  ['Diallo & Fils SARL', 'Naidoo & Sons (Pty) Ltd'],
  ['Diallo & Sons Ltd', 'Naidoo & Sons (Pty) Ltd'],
  ['diallo@gmail.com', 'naidoo@gmail.com'],
  ['Import-Export Nguema', 'Mokoena Import-Export'],
  ['nguema@yahoo.fr', 'mokoena@webmail.co.za'],
  ['SARAH BOUCHERIE', "SARAH'S BUTCHERY"],
  ['Grossiste Congo Distribution', 'Gauteng Wholesale Distribution'],
  ['Marché Total', 'Johannesburg Fresh Produce Market'],
  ['Port de Pointe-Noire', 'Port of Durban'],
  // Cities
  ['Pointe-Noire', 'Durban'],
  ['Brazzaville', 'Johannesburg'],
  ['Dolisie', 'Pretoria'],
  // Staff (French title left in old till reports)
  ['Gérant', 'Manager'],
];

// Values replaced only when they are the whole text.
const EXACT = {
  Brazza: 'Johannesburg', CFA: 'ZAR', 'BZV-2024-XXXX': '2024/XXXXXX/07',
  // Employee surnames
  Boukaka: 'Mahlangu', Malonga: 'Ndlovu', Mvioka: 'Botha', Louzolo: 'Khumalo', Nkaya: 'Mthembu',
  'André': 'Andre', 'Céline': 'Lerato', Jules: 'Sipho',
};
const PARTIAL_NAMES = [['Sophie Malonga', 'Sophie Ndlovu']];

// Congolese mobile prefixes (04, 05, 06) become South African ones.
const PREFIX = { 4: '83', 5: '72', 6: '82' };
const PHONE = /\+242\s*0?([456])\s*([\dX][\dX ]*[\dX])/g;
function convertPhones(text) {
  return text.replace(PHONE, (match, operator, rest) => {
    const digits = rest.replace(/\s/g, '');
    if (digits.length !== 7) return match;
    return `+27 ${PREFIX[operator]} ${digits.slice(0, 3)} ${digits.slice(3)}`;
  });
}

function localizeText(text) {
  if (Object.prototype.hasOwnProperty.call(EXACT, text)) return EXACT[text];
  let out = text;
  for (const [from, to] of [...REPLACEMENTS, ...PARTIAL_NAMES]) if (out.includes(from)) out = out.split(from).join(to);
  return out.includes('+242') ? convertPhones(out) : out;
}

function localizeState(value) {
  if (Array.isArray(value)) return value.map(localizeState);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = localizeState(v);
    return out;
  }
  return typeof value === 'string' ? localizeText(value) : value;
}

// Returns true when something was changed.
function migrateToSouthAfrica(db) {
  const version = db.exec('PRAGMA user_version')[0].values[0][0];
  if (version >= MIGRATION_VERSION) return false;

  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]?.values.map(r => r[0]) || [];
  for (const table of tables) {
    if (table === 'app_state') continue;
    const columns = db.exec(`PRAGMA table_info("${table}")`)[0].values
      .filter(c => /TEXT/i.test(c[2]) && !/password|hash|token/i.test(c[1])).map(c => c[1]);
    if (!columns.length) continue;
    const result = db.exec(`SELECT rowid, ${columns.map(c => `"${c}"`).join(',')} FROM "${table}"`)[0];
    if (!result) continue;
    for (const [rowid, ...values] of result.values) {
      values.forEach((value, i) => {
        if (typeof value !== 'string') return;
        const next = localizeText(value);
        if (next !== value) db.run(`UPDATE "${table}" SET "${columns[i]}"=? WHERE rowid=?`, [next, rowid]);
      });
    }
  }
  db.run('UPDATE boutiques SET tva=15 WHERE tva=18');

  const rows = db.exec('SELECT boutique_id, data FROM app_state')[0]?.values || [];
  for (const [boutiqueId, data] of rows) {
    let state;
    try { state = JSON.parse(data); } catch (_) { continue; }
    const next = localizeState(state);
    if (next.settings && Number(next.settings.tva) === 18) next.settings.tva = 15;
    const json = JSON.stringify(next);
    if (json !== data) db.run('UPDATE app_state SET data=?, version=version+1 WHERE boutique_id=?', [json, boutiqueId]);
  }

  db.run(`PRAGMA user_version = ${MIGRATION_VERSION}`);
  return true;
}

module.exports = { migrateToSouthAfrica, localizeText, localizeState };
