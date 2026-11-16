'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = 43127;
const baseUrl = `http://127.0.0.1:${port}`;
const dbPath = path.join(os.tmpdir(), `kinta-test-${process.pid}.db`);
let server;

async function request(endpoint, options = {}) {
  const response = await fetch(baseUrl + endpoint, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json();
  return { response, data };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(baseUrl + '/health');
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The test server does not start');
}

test.before(async () => {
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      NODE_ENV: 'test',
      ALLOW_BOUTIQUE_REGISTRATION: 'true',
      ALLOW_TEST_CLOCK: 'true',
      JWT_SECRET: 'kinta-integration-test-secret'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  await waitForServer();
});

test.after(() => {
  if (server) server.kill();
  try { fs.unlinkSync(dbPath); } catch (_) {}
});

test('protects the critical creation, sync and till flows', async () => {
  const weak = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ boutique_nom: 'Test', admin_login: 'admin', admin_password: '123456' })
  });
  assert.equal(weak.response.status, 400);

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ boutique_nom: 'Test Shop', admin_login: 'admin', admin_password: 'test-1234' })
  });
  assert.equal(registered.response.status, 200);
  const headers = { Authorization: `Bearer ${registered.data.token}` };

  const clock = await request('/api/test-clock', {
    method: 'PUT', headers,
    body: JSON.stringify({ datetime: '2026-02-14T10:30:00.000Z' })
  });
  assert.equal(clock.response.status, 200);
  assert.equal(clock.data.active, true);
  assert.match(clock.data.now, /^2026-02-14T10:30:/);

  const initial = await request('/api/state', { headers });
  assert.equal(initial.data.version, 0);
  const state = initial.data.state;
  state.produits.push({ id: 'P-TEST', nom: 'Test product', stk: 5, pv: 1000 });
  state.clients.push({id:'C-TEST',nom:'Credit customer',solde:0,credit:1500});

  const saved = await request('/api/state', {
    method: 'PUT', headers,
    body: JSON.stringify({ state, base_version: 0 })
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.version, 1);

  const stale = await request('/api/state', {
    method: 'PUT', headers,
    body: JSON.stringify({ state, base_version: 0 })
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.data.code, 'STATE_CONFLICT');

  const opened = await request('/api/caisse/ouvrir', {
    method: 'POST', headers, body: JSON.stringify({ fonds_initial: 5000 })
  });
  assert.equal(opened.response.status, 200);

  const excessiveDiscount = await request('/api/caisse/ventes', {
    method: 'POST', headers,
    body: JSON.stringify({ remise: 1001, lignes: [{ produit_id: 'P-TEST', quantite: 1 }] })
  });
  assert.equal(excessiveDiscount.response.status, 400);

  const sell=body=>request('/api/caisse/ventes',{method:'POST',headers,body:JSON.stringify({lignes:[{produit_id:'P-TEST',quantite:1}],...body})});
  assert.equal((await sell({mode:'Credit'})).response.status,400);
  const credit=await sell({mode:'Credit',client_id:'C-TEST'});
  assert.equal(credit.response.status,200);
  assert.equal(credit.data.ticket.statut,'On credit');
  assert.equal(credit.data.ticket.caissier,'admin');
  assert.equal(credit.data.state.clients.find(c=>c.id==='C-TEST').solde,1000);
  assert.equal(credit.data.state.mouvements.length,state.mouvements.length);
  assert.equal(credit.data.session.ventes_especes,0);
  assert.equal(credit.data.state.produits.find(p=>p.id==='P-TEST').stk,4);
  assert.equal((await sell({mode:'Credit',client_id:'C-TEST'})).response.status,409);
  const user=await request('/api/users',{method:'POST',headers,body:JSON.stringify({login:'cashier-test',password:'cashier-1234',role:'cashier',nom:'Second till'})});
  assert.equal(user.response.status,200);
  const login=await request('/api/auth/login',{method:'POST',body:JSON.stringify({login:'cashier-test',password:'cashier-1234'})});
  assert.equal(login.response.status,200);
  const cashierHeaders={Authorization:`Bearer ${login.data.token}`};
  const second=await request('/api/caisse/ouvrir',{method:'POST',headers:cashierHeaders,body:JSON.stringify({fonds_initial:200})});
  assert.equal(second.response.status,200);
  const cashSale=await request('/api/caisse/ventes',{method:'POST',headers:cashierHeaders,body:JSON.stringify({mode:'Cash',lignes:[{produit_id:'P-TEST',quantite:1}]})});
  assert.equal(cashSale.data.ticket.caissier,'Second till');
  assert.notEqual(cashSale.data.ticket.sessionId,credit.data.ticket.sessionId);
  const denied=await request('/api/caisse/cloturer',{method:'POST',headers:cashierHeaders,body:JSON.stringify({session_id:opened.data.session.id,especes_comptees:5000})});
  assert.equal(denied.response.status,403);
  const closed=await request('/api/caisse/cloturer',{method:'POST',headers,body:JSON.stringify({session_id:second.data.session.id,especes_comptees:1200})});
  assert.equal(closed.response.status,200);
  assert.equal(closed.data.rapport_z.caissier,'Second till');
  assert.equal(closed.data.rapport_z.ecart,0);
  const own=await request('/api/caisse/session',{headers});
  assert.equal(own.data.session.id,opened.data.session.id);
  const persisted=await request('/api/state',{headers});
  assert.equal(persisted.data.state.clients.find(c=>c.id==='C-TEST').solde,1000);

  const resetClock = await request('/api/test-clock', {
    method: 'PUT', headers, body: JSON.stringify({ reset: true })
  });
  assert.equal(resetClock.data.active, false);
});
