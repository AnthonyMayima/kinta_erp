const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../assets/js/app.js'),'utf8');
function extract(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);const end=source.indexOf('\n}',start)+2;return source.slice(start,end);}

test('shows expenses and attributes each sale to its recorded cashier',()=>{
  let rendered;
  const context=vm.createContext({db:{depenses:[{date:'2026-10-04',lib:'Rent',cat:'Charges',montant:250,mode:'Cash'}],factures:[{date:'2026-10-04',num:'TK-1',caissier:'Second till',montant:1000,statut:'Paid'}]},fmt:String,money:String,amt:String,esc:String,fmtDate:String,icon:String,sg:()=>{},setTimeout:()=>{},renderPaginatedTable:(id,rows)=>{rendered={id,rows};}});
  vm.runInContext(extract('renderExpenses')+';renderExpenses()',context);
  assert.equal(rendered.id,'t-dep');assert.match(rendered.rows[0],/Rent/);
  vm.runInContext(extract('renderSales')+';renderSales()',context);
  assert.match(rendered.rows[0],/Second till/);
});

test('account history: transfers and coloured Excel export',async()=>{
  let blob,filename;
  const mouvements=[{date:'2026-10-04',lib:'Sale',type:'in',montant:1000,mode:'Cash'},{date:'2026-10-04',lib:'Deposit',type:'transfer',montant:400,sourceAccount:'till',destinationAccount:'bank'},{date:'2026-10-04',lib:'Bank fees',type:'out',montant:50,mode:'Bank transfer'}];
  const context=vm.createContext({db:{mouvements},Blob,URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL:()=>{}},document:{createElement:()=>({click(){filename=this.download;}})},today:()=> '2026-10-04',setTimeout:()=>{},curSym:()=>'R',toInput:String});
  const start=source.indexOf('function treasuryAccountFromMode('),end=source.indexOf('function openTreasuryOptions(',start);
  vm.runInContext(source.slice(start,end)+extract('accountTransactions')+extract('downloadTreasuryExcel'),context);
  const bank=vm.runInContext("accountTransactions('bank')",context);
  assert.equal(bank.length,2);assert.equal(bank[0].type,'in');assert.equal(bank[1].type,'out');
  assert.equal(vm.runInContext('treasuryBalances().bank',context),350);
  assert.equal(vm.runInContext('treasuryBalances().till',context),600);
  assert.equal(vm.runInContext("accountTransactions('mobile').length",context),0);
  vm.runInContext('downloadTreasuryExcel()',context);
  const xml=await blob.text();
  assert.match(xml,/<Style ss:ID="in"><Font ss:Color="#16A34A"/);
  assert.match(xml,/<Style ss:ID="out"><Font ss:Color="#EF4444"/);
  assert.match(xml,/<Cell ss:StyleID="out"><Data ss:Type="String">Out/);
  assert.match(xml,/Bank fees/);assert.equal(filename,'kinta-treasury-2026-10-04.xml');
});
