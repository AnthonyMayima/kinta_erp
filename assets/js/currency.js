'use strict';
/* ════════════════════════════════════════════
   SOUTH AFRICAN RAND
   Kinta runs in English with the rand (R) as its only currency.
════════════════════════════════════════════ */
const LOCALE = 'en-GB';
document.documentElement.lang = 'en-ZA';

/* Amounts are stored in the original base unit (FCFA) and converted to rand
   for display and entry at a fixed rate, so existing data needs no migration.
   1 R = ZAR_RATE base units. Never change this rate once a shop has data:
   every stored amount would shift. */
const ZAR_RATE = 34.7;
const CURRENCY = {code:'ZAR', sym:'R', dec:2};
const curCode = () => CURRENCY.code;
const curInfo = () => CURRENCY;
const curSym = () => CURRENCY.sym;
const curRate = () => ZAR_RATE;
const curBefore = () => true;
// Stored amounts are rounded to 0.01 base unit.
const roundMoney = n => Math.round((Number(n)||0)*100)/100;
// Stored amount → rand, and rand typed by the user → stored amount.
const fromBase = n => (Number(n)||0)/ZAR_RATE;
const toBase = v => roundMoney((Number(v)||0)*ZAR_RATE);
// Shorthand for amounts written in rand in the source (demo data).
const R = toBase;
// Value to put in an input field, in rand.
const toInput = n => String(Math.round(fromBase(n)*100)/100);
// Stored amount shown in rand without the symbol: 1,234.50
function amt(n){return fromBase(n).toLocaleString(LOCALE,{minimumFractionDigits:2,maximumFractionDigits:2});}
// A typed amount that only exceeds a limit through rounding is brought back to the limit.
const capTo = (value,max) => value>max&&amt(value)===amt(max)?max:value;
// Stored amount shown in rand: R 1,234.50 · -R 20.00
function money(n){
  const v=Math.round(fromBase(n)*100)/100,sign=v<0?'-':'';
  return sign+'R '+Math.abs(v).toLocaleString(LOCALE,{minimumFractionDigits:2,maximumFractionDigits:2});
}
// Amount input fields: gv() converts what is typed (rand) to the stored unit.
const MONEY_INPUTS = new Set(['c-credit','cash-counted','cash-opening-fund','ce-credit','ce-solde','client-payment-amount','dep-mont','ecr-montant','emp-sal','mv-mont','pay-ach-montant','pos-recu','prod-pa','prod-pv','rec-frais','rec-paye']);
function isMoneyInput(id){
  if(id==='pos-remise-val'){const t=document.getElementById('pos-remise-type');return !!t&&t.value!=='pct';}
  return MONEY_INPUTS.has(id);
}
